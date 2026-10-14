const { pool, transaction } = require('./db')
const config = require('./config')
const { sendUrgentOrderEmail } = require('./urgent-email')
const { formatDormBuilding } = require('./business-rules')
const {
  URGENT_ALERT_TYPE,
  URGENT_ALERT_RETRY_DELAY_MINUTES,
  URGENT_ALERT_MAX_ATTEMPTS,
  buildUrgentAlertEmail,
  hasCompletedPayment
} = require('./urgent-alert-rules')

function safeEmailError(error) {
  const code = String(error && (error.code || error.name) || 'EMAIL_ERROR').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 80)
  return `邮件发送结果不确定：${code || 'EMAIL_ERROR'}`
}

async function abandonInterruptedAttempts() {
  await pool.execute(
    `UPDATE order_notifications
        SET status = 'unknown', processing_started_at = NULL,
            last_error = '发送进程中断，结果未知；为避免重复邮件不自动重试', updated_at = UTC_TIMESTAMP()
      WHERE notification_type = ?
        AND status = 'processing'
        AND processing_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)`,
    [URGENT_ALERT_TYPE]
  )
}

async function claimAlert(notificationId) {
  return transaction(async connection => {
    const [identityRows] = await connection.execute(
      'SELECT order_id FROM order_notifications WHERE id = ? LIMIT 1',
      [notificationId]
    )
    if (!identityRows.length) return null
    const orderId = identityRows[0].order_id

    // 与抢单、取消保持相同的加锁顺序：先订单，后提醒任务。
    const [orderRows] = await connection.execute(
      `SELECT id, urgency, status, rider_id, building, paid_amount, original_price, coupon_discount
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
    if (!order || order.urgency !== 'urgent' || order.status !== 'waiting' || !hasCompletedPayment(order) || order.rider_id) {
      await connection.execute(
        `UPDATE order_notifications
            SET status = 'skipped', next_attempt_at = NULL, processing_started_at = NULL,
                last_error = '订单已接单、取消或不再符合提醒条件', updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [notificationId]
      )
      return null
    }

    const [settingRows] = await connection.execute(
      'SELECT review_mode, service_status FROM platform_settings WHERE id = 1 LIMIT 1'
    )
    const settings = settingRows[0]
    if (!settings || Number(settings.review_mode) !== 0 || settings.service_status !== 'open') {
      await connection.execute(
        `UPDATE order_notifications
            SET status = 'pending', next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${URGENT_ALERT_RETRY_DELAY_MINUTES} MINUTE),
                last_error = '审核模式或暂停服务期间暂缓提醒', updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [notificationId]
      )
      return null
    }

    if (Number(notification.attempts) >= URGENT_ALERT_MAX_ATTEMPTS) {
      await connection.execute(
        `UPDATE order_notifications
            SET status = 'failed', next_attempt_at = NULL,
                last_error = '邮件服务器明确拒绝次数已达上限', updated_at = UTC_TIMESTAMP()
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
      building: formatDormBuilding(order.building, order.campus) || '未知',
      attempts: Number(notification.attempts) + 1
    }
  })
}

async function recheckClaimedAlert(alert) {
  const [rows] = await pool.execute(
    `SELECT o.status AS order_status, o.rider_id, o.urgency, o.paid_amount,
            o.original_price, o.coupon_discount,
            settings.review_mode, settings.service_status
       FROM order_notifications notification
       JOIN orders o ON o.id = notification.order_id
       JOIN platform_settings settings ON settings.id = 1
      WHERE notification.id = ? AND notification.status = 'processing'
      LIMIT 1`,
    [alert.id]
  )
  const current = rows[0]
  if (!current) return 'skip'
  if (current.order_status !== 'waiting' || current.rider_id || current.urgency !== 'urgent' || !hasCompletedPayment(current)) return 'skip'
  if (Number(current.review_mode) !== 0 || current.service_status !== 'open') return 'defer'
  return 'send'
}

async function releaseClaim(alert, action) {
  if (action === 'defer') {
    await pool.execute(
      `UPDATE order_notifications
          SET status = 'pending', attempts = GREATEST(attempts - 1, 0),
              next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${URGENT_ALERT_RETRY_DELAY_MINUTES} MINUTE),
              processing_started_at = NULL, last_error = '审核模式或暂停服务期间暂缓提醒', updated_at = UTC_TIMESTAMP()
        WHERE id = ? AND status = 'processing'`,
      [alert.id]
    )
    return
  }
  await pool.execute(
    `UPDATE order_notifications
        SET status = 'skipped', next_attempt_at = NULL, processing_started_at = NULL,
            last_error = '发送前复核发现订单已接单、取消或不再符合提醒条件', updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'processing'`,
    [alert.id]
  )
}

async function finishProviderResult(alert, result) {
  const nextStatus = result.ok
    ? 'sent'
    : alert.attempts < URGENT_ALERT_MAX_ATTEMPTS ? 'retryable' : 'failed'
  const nextAttemptSql = nextStatus === 'retryable'
    ? `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${URGENT_ALERT_RETRY_DELAY_MINUTES} MINUTE)`
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
    message: result.ok ? 'urgent order email accepted by provider' : 'urgent order email rejected by provider',
    order_id: alert.orderId,
    notification_id: alert.id,
    provider_code: result.code,
    attempt: alert.attempts
  }))
}

async function finishUnknownResult(alert, error) {
  const safeError = safeEmailError(error)
  await pool.execute(
    `UPDATE order_notifications
        SET status = 'unknown', next_attempt_at = NULL, processing_started_at = NULL,
            last_error = ?, updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'processing'`,
    [safeError, alert.id]
  )
  console.error(JSON.stringify({
    level: 'error',
    message: 'urgent order email result unknown',
    order_id: alert.orderId,
    notification_id: alert.id,
    error_code: safeError
  }))
}

async function processUrgentOrderAlerts(limit = 20) {
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
    [URGENT_ALERT_TYPE]
  )

  let processed = 0
  for (const row of rows) {
    const alert = await claimAlert(row.id)
    if (!alert) continue
    const action = await recheckClaimedAlert(alert)
    if (action !== 'send') {
      await releaseClaim(alert, action)
      continue
    }
    try {
      const result = await sendUrgentOrderEmail(
        alert.orderId,
        buildUrgentAlertEmail({ id: alert.orderId, building: alert.building }, config.adminCorsOrigin)
      )
      await finishProviderResult(alert, result)
    } catch (error) {
      // SMTP 超时可能发生在邮件服务器已接收之后；不自动重试，避免重复发送。
      await finishUnknownResult(alert, error)
    }
    processed += 1
  }
  return { disabled: false, processed }
}

module.exports = { processUrgentOrderAlerts }
