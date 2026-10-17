const { HttpError } = require('./http')
const { normalizeCampus, normalizeCampusLenient } = require('./campus-config')

// 与下单、接单、骑手申请审核共用 users → riders → orders 的锁顺序。
// 必须在事务内重新读取，不能用鉴权时的旧校区判断或创建订单。
async function lockCampusUser(connection, userId, expectedCampus) {
  const [rows] = await connection.execute('SELECT * FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [userId])
  const user = rows[0]
  if (!user || user.status !== 'active') throw new HttpError(401, '用户账号不可用', 'MINI_ACCOUNT_DISABLED')
  if (expectedCampus && normalizeCampusLenient(user.campus) !== normalizeCampusLenient(expectedCampus)) {
    throw new HttpError(409, '校区已变更，请刷新后重试', 'CAMPUS_CHANGED')
  }
  return user
}

async function applyCampusChange(connection, user, targetCampus, expectedFromCampus) {
  const toCampus = normalizeCampus(targetCampus)
  if (!toCampus) throw new HttpError(400, '未知校区', 'INVALID_CAMPUS')
  const fromCampus = normalizeCampusLenient(user.campus)
  if (expectedFromCampus && normalizeCampusLenient(expectedFromCampus) !== fromCampus) {
    throw new HttpError(409, '用户校区已变更，该申请已失效', 'CAMPUS_CHANGED')
  }
  if (toCampus === fromCampus) throw new HttpError(400, '目标校区与当前校区相同', 'INVALID_CAMPUS_CHANGE')
  // 包含暂停资格的骑手；资格状态不改变其未完配送任务的约束。
  const [riders] = await connection.execute('SELECT id FROM riders WHERE user_id = ? FOR UPDATE', [user.id])
  const [orders] = await connection.execute(
    "SELECT id FROM orders WHERE user_id = ? AND status NOT IN ('completed', 'cancelled') LIMIT 1 FOR UPDATE", [user.id]
  )
  if (orders.length) throw new HttpError(409, '还有未完成的下单，请先处理完再转校区', 'CAMPUS_CHANGE_HAS_OPEN_ORDERS')
  for (const rider of riders) {
    const [tasks] = await connection.execute(
      "SELECT id FROM orders WHERE rider_id = ? AND status NOT IN ('completed', 'cancelled') LIMIT 1 FOR UPDATE", [rider.id]
    )
    if (tasks.length) throw new HttpError(409, '还有未完成的配送任务，请先处理完再转校区', 'CAMPUS_CHANGE_HAS_RIDER_TASKS')
  }
  // 地址属于旧校区，转区后必须重新填写。历史订单、优惠券归属和骑手余额均不改。
  await connection.execute(
    "UPDATE users SET campus = ?, building = '', room = '', address = '', updated_at = UTC_TIMESTAMP() WHERE id = ?", [toCampus, user.id]
  )
  await connection.execute('UPDATE riders SET campus = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?', [toCampus, user.id])
  // 尚未审批的骑手申请也跟随，避免后续审批又把骑手写回旧校区。
  await connection.execute(
    "UPDATE rider_applications SET campus = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'pending'", [toCampus, user.id]
  )
  return { fromCampus, toCampus, riderSynced: riders.length > 0 }
}

async function autoChangeCampus(connection, userId, toCampus, reason, expectedCampus) {
  const user = await lockCampusUser(connection, userId, expectedCampus)
  const changed = await applyCampusChange(connection, user, toCampus)
  // 新提交成功时使旧待审申请失效，保留历史；校验失败则事务回滚，不触碰旧申请。
  await connection.execute(
    `UPDATE campus_change_requests SET status = 'rejected', review_reason = '用户已重新提交并完成校区变更，本申请已失效',
       reviewed_by = NULL, reviewed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
     WHERE user_id = ? AND status = 'pending'`, [userId]
  )
  const [created] = await connection.execute(
    `INSERT INTO campus_change_requests
       (user_id, from_campus, to_campus, reason, status, review_reason, reviewed_at, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'approved', '系统校验通过，提交后立即生效', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [userId, changed.fromCampus, changed.toCampus, reason]
  )
  return { id: String(created.insertId), ...changed, status: 'approved', statusText: '已生效' }
}

module.exports = { lockCampusUser, applyCampusChange, autoChangeCampus }
