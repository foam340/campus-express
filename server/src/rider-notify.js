/**
 * 骑手新单邮件：订单进入大厅（未支付→已支付，或免支付直接落单）后，尽快一封 BCC 邮件
 * 提醒「本校区所有填了邮箱的骑手」来抢单。
 *
 * 与 urgent-alert（很急单 30 分钟无人接提醒运营）是同一套 order_notifications 机制，
 * 只是 notification_type 不同、扫描更快（60 秒）、收件人是骑手而非运营、且按订单 campus 解析收件人。
 */
const { pool, transaction } = require('./db')
const config = require('./config')
const { sendRiderNotificationEmail, sendWithdrawalRequestEmail } = require('./urgent-email')
const { formatDormBuilding } = require('./business-rules')
const { campusLabel, normalizeCampusLenient, stationLabel, getCampusConfig } = require('./campus-config')

const NEW_ORDER_RIDER_EMAIL_TYPE = 'new_order_rider_email'
const NEW_ORDER_RIDER_SCAN_INTERVAL_MS = 60 * 1000
const NEW_ORDER_RIDER_RETRY_DELAY_MINUTES = 1
const NEW_ORDER_RIDER_MAX_ATTEMPTS = 3

// 校区展示名（campusLabel）/ 驿站文案 / 地址隐藏策略统一走 campus-config（单一权威）。
function pickupText(order) {
  const cfg = getCampusConfig(order.campus)
  if (cfg && cfg.stations && cfg.stations.length) {
    return stationLabel(order.campus, order.pickup_station) || '菜鸟驿站'
  }
  return order.pickup_scope === 'off_campus' ? '校外' : '校内'
}

function destinationText(order) {
  const cfg = getCampusConfig(order.campus)
  if (cfg && cfg.emailHideAddress) return '接单后查看详细地址'
  return formatDormBuilding(order.building, order.campus) || '接单后查看'
}

function buildNewOrderRiderEmail(order) {
  const safeId = String(order && order.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(-8)
  return {
    subject: `[校园代拿] ${campusLabel(order.campus)}校区新订单待接：${safeId}`,
    text: [
      `${campusLabel(order.campus)}校区有新的待接订单：${safeId}`,
      `取件点：${pickupText(order)}`,
      `件数：${Number(order.pieces) || 1} 件`,
      `骑手可得：¥${Number(order.rider_income) || 0}`,
      `送达：${destinationText(order)}`,
      '',
      '请打开小程序「骑手大厅」抢单。'
    ].join('\n')
  }
}

async function queueNewOrderRiderEmail(executor, orderId) {
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('骑手新单邮件任务写入器无效')
  if (!config.urgentEmail.enabled) return false
  const [result] = await executor.execute(
    `INSERT IGNORE INTO order_notifications
       (order_id, notification_type, status, due_at, attempts, next_attempt_at,
        processing_started_at, provider_request_id, provider_biz_id, last_error,
        sent_at, created_at, updated_at)
     SELECT o.id, ?, 'pending', UTC_TIMESTAMP(),
            0, NULL, NULL, '', '', '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()
       FROM orders o
       JOIN platform_settings settings ON settings.campus = o.campus
      WHERE o.id = ?
        AND o.status = 'waiting'
        AND o.rider_id IS NULL
        AND settings.review_mode = 0
        AND settings.service_status = 'open'`,
    [NEW_ORDER_RIDER_EMAIL_TYPE, orderId]
  )
  return Number(result.affectedRows) === 1
}

async function skipNewOrderRiderEmail(executor, orderId, reason) {
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('骑手新单邮件任务更新器无效')
  if (!config.urgentEmail.enabled) return false
  await executor.execute(
    `UPDATE order_notifications
        SET status = 'skipped', next_attempt_at = NULL, processing_started_at = NULL,
            last_error = ?, updated_at = UTC_TIMESTAMP()
      WHERE order_id = ?
        AND notification_type = ?
        AND status IN ('pending', 'retryable')`,
    [String(reason || 'order_no_longer_waiting').slice(0, 500), orderId, NEW_ORDER_RIDER_EMAIL_TYPE]
  )
  return true
}

// 订单被骑手转单退回大厅后，把此前因接单而置为 skipped 的提醒重新排上。
// 与 queueNewOrderRiderEmail 的 INSERT IGNORE 同理：显式重置，避免唯一键静默吞掉后邮件永远不发。
// 只重置 skipped，不重发已 sent 的（骑手已经收到过，避免刷屏）。
async function requeueNewOrderRiderEmail(executor, orderId, reason) {
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('骑手新单邮件任务重置器无效')
  if (!config.urgentEmail.enabled) return false
  const [result] = await executor.execute(
    `UPDATE order_notifications n
       JOIN orders o ON o.id = n.order_id
       JOIN platform_settings settings ON settings.campus = o.campus
        SET n.status = 'pending', n.attempts = 0, n.next_attempt_at = NULL,
            n.processing_started_at = NULL, n.sent_at = NULL, n.last_error = ?,
            n.due_at = UTC_TIMESTAMP(), n.updated_at = UTC_TIMESTAMP()
      WHERE n.order_id = ?
        AND n.notification_type = ?
        AND n.status = 'skipped'
        AND o.status = 'waiting'
        AND o.rider_id IS NULL
        AND settings.review_mode = 0
        AND settings.service_status = 'open'`,
    [String(reason || 'order_transferred_back').slice(0, 500), orderId, NEW_ORDER_RIDER_EMAIL_TYPE]
  )
  return Number(result.affectedRows) > 0
}

async function abandonInterruptedAttempts() {
  await pool.execute(
    `UPDATE order_notifications
        SET status = 'unknown', processing_started_at = NULL,
            last_error = '发送进程中断，结果未知；为避免重复邮件不自动重试', updated_at = UTC_TIMESTAMP()
      WHERE notification_type = ?
        AND status = 'processing'
        AND processing_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)`,
    [NEW_ORDER_RIDER_EMAIL_TYPE]
  )
}

async function claimNotification(notificationId) {
  return transaction(async connection => {
    const [identityRows] = await connection.execute(
      'SELECT order_id FROM order_notifications WHERE id = ? LIMIT 1',
      [notificationId]
    )
    if (!identityRows.length) return null
    const orderId = identityRows[0].order_id

    // 与抢单、取消保持相同的加锁顺序：先订单，后提醒任务。
    const [orderRows] = await connection.execute(
      `SELECT id, campus, status, rider_id, building, pickup_scope, pickup_station, pieces, original_price, rider_income
         FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [orderId]
    )
    const [notificationRows] = await connection.execute(
      `SELECT id, order_id, status, attempts, due_at, next_attempt_at
         FROM order_notifications
        WHERE id = ?
          AND status IN ('pending', 'retryable')
          AND due_at <= UTC_TIMESTAMP()
          AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
        LIMIT 1 FOR UPDATE`,
      [notificationId]
    )
    const notification = notificationRows[0]
    if (!notification) return null

    const order = orderRows[0]
    if (!order || order.status !== 'waiting' || order.rider_id) {
      await connection.execute(
        `UPDATE order_notifications
            SET status = 'skipped', next_attempt_at = NULL, processing_started_at = NULL,
                last_error = '订单已接单、取消或不再符合提醒条件', updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [notificationId]
      )
      return null
    }

    const campus = normalizeCampusLenient(order.campus)
    const [settingRows] = await connection.execute(
      'SELECT review_mode, service_status FROM platform_settings WHERE campus = ? LIMIT 1',
      [campus]
    )
    const settings = settingRows[0]
    if (!settings || Number(settings.review_mode) !== 0 || settings.service_status !== 'open') {
      await connection.execute(
        `UPDATE order_notifications
            SET status = 'pending', next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${NEW_ORDER_RIDER_RETRY_DELAY_MINUTES} MINUTE),
                last_error = '审核模式或暂停服务期间暂缓提醒', updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [notificationId]
      )
      return null
    }

    if (Number(notification.attempts) >= NEW_ORDER_RIDER_MAX_ATTEMPTS) {
      await connection.execute(
        `UPDATE order_notifications
            SET status = 'failed', next_attempt_at = NULL,
                last_error = '邮件服务器明确拒绝次数已达上限', updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [notificationId]
      )
      return null
    }

    // 收件人：本校区所有已过审且填了邮箱的骑手（去重）。
    const [recipientRows] = await connection.execute(
      "SELECT email FROM riders WHERE campus = ? AND status = 'approved' AND email IS NOT NULL AND email <> ''",
      [campus]
    )
    const recipients = [...new Set(recipientRows.map(row => String(row.email).trim()).filter(Boolean))]
    if (!recipients.length) {
      await connection.execute(
        `UPDATE order_notifications
            SET status = 'skipped', next_attempt_at = NULL, processing_started_at = NULL,
                last_error = '本校区暂无填写邮箱的骑手', updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [notificationId]
      )
      return null
    }

    await connection.execute(
      `UPDATE order_notifications
          SET status = 'processing', attempts = attempts + 1, next_attempt_at = NULL,
              processing_started_at = UTC_TIMESTAMP(), last_error = '', updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [notificationId]
    )
    return {
      id: notificationId,
      orderId: order.id,
      order,
      recipients,
      attempts: Number(notification.attempts) + 1
    }
  })
}

async function finishProviderResult(alert, result) {
  const nextStatus = result.ok
    ? 'sent'
    : alert.attempts < NEW_ORDER_RIDER_MAX_ATTEMPTS ? 'retryable' : 'failed'
  const nextAttemptSql = nextStatus === 'retryable'
    ? `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${NEW_ORDER_RIDER_RETRY_DELAY_MINUTES} MINUTE)`
    : 'NULL'
  await pool.execute(
    `UPDATE order_notifications
        SET status = ?, next_attempt_at = ${nextAttemptSql}, processing_started_at = NULL,
            provider_request_id = ?, provider_biz_id = ?,
            last_error = ?, sent_at = CASE WHEN ? = 'sent' THEN UTC_TIMESTAMP() ELSE sent_at END,
            updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'processing'`,
    [
      nextStatus,
      result.messageId,
      result.response,
      result.ok ? '' : `邮件服务器明确拒绝：${result.code}`.slice(0, 500),
      nextStatus,
      alert.id
    ]
  )
  console.log(JSON.stringify({
    level: result.ok ? 'info' : 'warn',
    message: result.ok ? 'new order rider email accepted by provider' : 'new order rider email rejected by provider',
    order_id: alert.orderId,
    notification_id: alert.id,
    recipients: alert.recipients.length,
    provider_code: result.code,
    attempt: alert.attempts
  }))
}

async function finishUnknownResult(alert, error) {
  const safeError = String(error && (error.code || error.name) || 'EMAIL_ERROR').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80)
  await pool.execute(
    `UPDATE order_notifications
        SET status = 'unknown', next_attempt_at = NULL, processing_started_at = NULL,
            last_error = ?, updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'processing'`,
    [`邮件发送结果不确定：${safeError}`, alert.id]
  )
  console.error(JSON.stringify({
    level: 'error',
    message: 'new order rider email result unknown',
    order_id: alert.orderId,
    notification_id: alert.id,
    error_code: safeError
  }))
}

async function processNewOrderRiderEmails(limit = 20) {
  if (!config.urgentEmail.enabled) return { disabled: true, processed: 0 }
  await abandonInterruptedAttempts()
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20))
  const [rows] = await pool.query(
    `SELECT id
       FROM order_notifications
      WHERE notification_type = ?
        AND status IN ('pending', 'retryable')
        AND due_at <= UTC_TIMESTAMP()
        AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
      ORDER BY due_at ASC
      LIMIT ${safeLimit}`,
    [NEW_ORDER_RIDER_EMAIL_TYPE]
  )

  let processed = 0
  for (const row of rows) {
    const alert = await claimNotification(row.id)
    if (!alert) continue
    try {
      const result = await sendRiderNotificationEmail(alert.recipients, buildNewOrderRiderEmail(alert.order))
      await finishProviderResult(alert, result)
    } catch (error) {
      // SMTP 超时可能发生在邮件服务器已接收之后；不自动重试，避免重复发送。
      await finishUnknownResult(alert, error)
    }
    processed += 1
  }
  return { disabled: false, processed }
}

// 骑手提现结清回执正文：列出本次结清的每笔订单简略信息（完整订单号、骑手可得、完成日期、校区+楼栋）。
// amount 与 rider_income 均为元（orders 表 decimal(10,2)、mysql2 返回字符串），直接显示，勿再 /100。
function withdrawLocationText(order) {
  const label = campusLabel(order.campus)
  const building = formatDormBuilding(order.building, order.campus)
  return building ? `${label} ${building}` : label
}

function buildWithdrawalEmail(amount, orders) {
  const amountYuan = Number(amount || 0).toFixed(2)
  const safeOrders = Array.isArray(orders) ? orders : []
  const lines = safeOrders.map((order, index) => {
    const orderId = String(order && order.id || '')
    const money = Number(order && order.rider_income || 0).toFixed(2)
    const date = String(order && order.completed_date || '')
    return `${index + 1}. ${orderId}  骑手可得 ¥${money}  完成 ${date}  ${withdrawLocationText(order)}`
  })
  return {
    subject: `[校园代拿] 提现通过 ¥${amountYuan}，本次结清 ${safeOrders.length} 笔`,
    text: [
      `你的提现已通过确认，本次结清 ¥${amountYuan}，共 ${safeOrders.length} 笔订单：`,
      '',
      ...lines,
      '',
      '感谢你的辛勤配送，继续加油！'
    ].join('\n')
  }
}

// 仅由新申请提交成功后触发一次；不扫描、不持久排队、不重试。
function notifyWithdrawalRequest(withdrawalId) {
  if (!config.urgentEmail.enabled || !config.withdrawalRequestEmailTo) return
  setImmediate(async () => {
    try {
      const [rows] = await pool.execute(
        `SELECT w.id, w.rider_id, w.amount, r.name, r.name_note, r.campus,
                DATE_FORMAT(DATE_ADD(w.requested_at, INTERVAL 8 HOUR), '%Y-%m-%d %H:%i:%s') AS requested_cn
           FROM withdrawals w
           JOIN riders r ON r.id = w.rider_id
           JOIN platform_settings settings ON settings.campus = r.campus
          WHERE w.id = ? AND w.status = 'pending' AND settings.review_mode = 0
          LIMIT 1`,
        [withdrawalId]
      )
      const item = rows[0]
      if (!item) return
      const amount = Number(item.amount).toFixed(2)
      const message = {
        subject: `[校园递小帮] ${campusLabel(item.campus)}校区有新的提现申请：¥${amount}`,
        text: [
          `提现编号：${item.id}`,
          `校区：${campusLabel(item.campus)}`,
          `骑手：${item.name_note || item.name || '骑手'}`,
          `骑手编号：${item.rider_id}`,
          `申请金额：¥${amount}`,
          `申请时间：${item.requested_cn}（北京时间）`,
          '',
          '请登录管理台「提现审核」核实并处理：',
          config.adminCorsOrigin,
          '此邮件仅提醒新申请，实际打款及审核状态以管理台核实结果为准。'
        ].join('\n')
      }
      const result = await sendWithdrawalRequestEmail(message)
      console.log(JSON.stringify({
        level: result.ok ? 'info' : 'warn',
        message: result.ok ? 'withdrawal request email accepted by provider' : 'withdrawal request email rejected by provider',
        withdrawal_id: String(withdrawalId),
        provider_code: result.code
      }))
    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        message: 'withdrawal request email send failed',
        withdrawal_id: String(withdrawalId),
        error_code: String(error && (error.code || error.name) || 'EMAIL_ERROR').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80)
      }))
    }
  })
}

module.exports = {
  NEW_ORDER_RIDER_SCAN_INTERVAL_MS,
  queueNewOrderRiderEmail,
  skipNewOrderRiderEmail,
  requeueNewOrderRiderEmail,
  processNewOrderRiderEmails,
  buildWithdrawalEmail,
  notifyWithdrawalRequest
}
