const { pool, transaction } = require('./db')
const { deleteUpload } = require('./uploads')

// 定期清理已取消订单：删除「取消超过 7 天」的 cancelled 订单及其关联数据
// （售后、退款流水、附件、通知、骑手经验事件），并删除附件对应的磁盘文件，
// 释放数据库与磁盘空间。仅针对 cancelled 状态，不影响其他订单。
async function cleanupCancelledOrders() {
  const [orders] = await pool.query(
    `SELECT id FROM orders
      WHERE status = 'cancelled' AND cancelled_at IS NOT NULL
        AND cancelled_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
      ORDER BY cancelled_at ASC
      LIMIT 200`
  )
  let deleted = 0
  for (const row of orders) {
    try {
      await deleteCancelledOrder(row.id)
      deleted += 1
      console.log(JSON.stringify({ level: 'info', message: 'cancelled order cleaned', order_id: row.id }))
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'cancelled order cleanup failed', order_id: row.id, error: error.message }))
    }
  }
  if (deleted) console.log(JSON.stringify({ level: 'info', message: 'order cleanup sweep done', deleted }))
  return deleted
}

// 删除单个取消订单：事务内按外键依赖顺序删除关联记录，事务提交后删除磁盘文件。
async function deleteCancelledOrder(orderId) {
  const storagePaths = await transaction(async connection => {
    // 先取出该订单附件对应的磁盘文件路径，供事务外删除
    const [attachments] = await connection.execute(
      `SELECT u.id AS upload_id, u.storage_path
         FROM order_attachments a
         JOIN order_uploads u ON u.id = a.upload_id
        WHERE a.order_id = ?`,
      [orderId]
    )
    const uploadIds = attachments.map(item => item.upload_id)
    // 按外键依赖顺序删除关联记录（子表在前，主表最后）
    await connection.execute('DELETE FROM order_attachments WHERE order_id = ?', [orderId])
    await connection.execute('DELETE FROM order_notifications WHERE order_id = ?', [orderId])
    await connection.execute('DELETE FROM rider_experience_events WHERE order_id = ?', [orderId])
    await connection.execute('DELETE FROM order_refunds WHERE order_id = ?', [orderId])
    await connection.execute('DELETE FROM after_sales WHERE order_id = ?', [orderId])
    await connection.execute('DELETE FROM order_transfers WHERE order_id = ?', [orderId])
    if (uploadIds.length) {
      const placeholders = uploadIds.map(() => '?').join(',')
      await connection.execute(`DELETE FROM order_uploads WHERE id IN (${placeholders})`, uploadIds)
    }
    await connection.execute('DELETE FROM orders WHERE id = ?', [orderId])
    return attachments.map(item => item.storage_path)
  })
  // 事务提交后删除磁盘文件；失败仅留下孤儿文件，不影响功能
  for (const storagePath of storagePaths) {
    await deleteUpload(storagePath)
  }
}

// 清理孤儿上传：传成功了、却从没挂到任何订单上的图片。
//
// 主因：小程序「确认已送达」是「先 wx.uploadFile 传图、再发状态请求」，而上传期间界面上没有任何反馈，
// 骑手以为没点上就反复点，每点一次整批图片从头重传一遍——只有最后成功的那一次会被挂单，之前的全成孤儿。
// 2026-09-21 线上实测：送达图 1338 张孤儿 / 647MB，占送达图上传总量的 59%。
//
// 判定条件只有两个：status='uploaded' 且创建时间超过保留期。
// ⚠️ status='uploaded' 本身就等价于「没有任何 order_attachments 引用」——挂单成功时会被置为 'attached'
//    （见 mini.js 的 POST /rider/orders/:id/status）。反过来不成立的那些（已挂单但订单被取消清理掉的）
//    在 deleteCancelledOrder 里会连行一起删，不会落回 'uploaded'。
// 保留期与 cleanupCancelledOrders 一致取 7 天，用来挡掉骑手刚传完、还没来得及点确认送达的在途图片。
async function cleanupOrphanUploads(options) {
  const settings = options || {}
  const retentionDays = Math.max(1, Math.floor(Number(settings.retentionDays) || 7))
  const batchSize = Math.max(1, Math.floor(Number(settings.batchSize) || 500))
  const maxBatches = Math.max(1, Math.floor(Number(settings.maxBatches) || 20))
  const dryRun = settings.dryRun === true

  const window = [retentionDays]
  const conditions = "status = 'uploaded' AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)"

  // dry run 走单独的聚合分支：删除分支靠「删掉才不会再被选中」推进，dry run 不删，
  // 照那个循环走会在每一批重复选中同一批行、把数字越滚越大。
  if (dryRun) {
    const [summary] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(file_size), 0) AS bytes, MIN(created_at) AS oldest, MAX(created_at) AS newest
         FROM order_uploads WHERE ${conditions}`,
      window
    )
    const row = summary[0] || {}
    const result = {
      deleted: Number(row.total) || 0,
      reclaimedBytes: Number(row.bytes) || 0,
      oldest: row.oldest || null,
      newest: row.newest || null,
      dryRun: true
    }
    console.log(JSON.stringify({
      level: 'info',
      message: 'orphan upload dry-run',
      would_delete: result.deleted,
      reclaimed_mb: Math.round(result.reclaimedBytes / 1048576 * 10) / 10,
      retention_days: retentionDays,
      oldest: result.oldest,
      newest: result.newest
    }))
    return result
  }

  let deleted = 0
  let reclaimedBytes = 0
  for (let batch = 0; batch < maxBatches; batch += 1) {
    // SELECT 也放进事务并 FOR UPDATE 锁住候选行：从「决定删」到「真删掉」之间，
    // 挂单请求（把 status 翻成 attached）会在这把锁上阻塞，不会出现「DB 行保住、文件却被删」的窗口。
    // 事务返回的 removed 就是真正被删掉的那批行，磁盘文件只按它来删——不再按事务外的 SELECT 快照。
    // 仍用 .query（而非 execute）：LIMIT / INTERVAL 的占位符走客户端转义，execute 的预处理协议对它们挑食。
    const removed = await transaction(async connection => {
      const [rows] = await connection.query(
        `SELECT id, storage_path, file_size
           FROM order_uploads
          WHERE ${conditions}
          ORDER BY created_at ASC
          LIMIT ? FOR UPDATE`,
        window.concat([batchSize])
      )
      if (!rows.length) return []
      const ids = rows.map(row => row.id)
      const placeholders = ids.map(() => '?').join(',')
      await connection.execute(`DELETE FROM order_uploads WHERE id IN (${placeholders})`, ids)
      return rows.map(row => ({ id: row.id, storage_path: row.storage_path, file_size: Number(row.file_size) || 0 }))
    })
    if (!removed.length) break
    // 事务提交后删磁盘文件；失败仅留下孤儿文件，不影响功能（与 deleteCancelledOrder 同样处理）。
    for (const row of removed) {
      try { await deleteUpload(row.storage_path) } catch (error) {
        console.error(JSON.stringify({ level: 'error', message: 'orphan upload file delete failed', upload_id: row.id, error: error.message }))
      }
    }
    deleted += removed.length
    reclaimedBytes += removed.reduce((sum, row) => sum + row.file_size, 0)
    if (removed.length < batchSize) break
  }
  if (deleted) {
    console.log(JSON.stringify({
      level: 'info',
      message: 'orphan upload cleanup done',
      deleted, reclaimed_mb: Math.round(reclaimedBytes / 1048576 * 10) / 10, retention_days: retentionDays
    }))
  }
  return { deleted, reclaimedBytes, dryRun: false }
}

module.exports = { cleanupCancelledOrders, cleanupOrphanUploads }
