const {
  URGENT_ALERT_TYPE,
  URGENT_ALERT_DELAY_MINUTES
} = require('./urgent-alert-rules')
const config = require('./config')

async function queueUrgentOrderAlert(executor, orderId) {
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('邮件提醒任务写入器无效')
  if (!config.urgentEmail.enabled) return false
  const [result] = await executor.execute(
    `INSERT IGNORE INTO order_notifications
       (order_id, notification_type, status, due_at, attempts, next_attempt_at,
        processing_started_at, provider_request_id, provider_biz_id, last_error,
        sent_at, created_at, updated_at)
     SELECT o.id, ?, 'pending', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${URGENT_ALERT_DELAY_MINUTES} MINUTE),
            0, NULL, NULL, '', '', '', NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP()
       FROM orders o
       JOIN platform_settings settings ON settings.id = 1
      WHERE o.id = ?
        AND o.urgency = 'urgent'
        AND o.status = 'waiting'
        AND (o.paid_amount > 0 OR o.original_price - o.coupon_discount <= 0)
        AND o.rider_id IS NULL
        AND settings.review_mode = 0
        AND settings.service_status = 'open'`,
    [URGENT_ALERT_TYPE, orderId]
  )
  return Number(result.affectedRows) === 1
}

async function skipUrgentOrderAlert(executor, orderId, reason) {
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('邮件提醒任务更新器无效')
  if (!config.urgentEmail.enabled) return false
  await executor.execute(
    `UPDATE order_notifications
        SET status = 'skipped', next_attempt_at = NULL, processing_started_at = NULL,
            last_error = ?, updated_at = UTC_TIMESTAMP()
      WHERE order_id = ?
        AND notification_type = ?
        AND status IN ('pending', 'retryable')`,
    [String(reason || 'order_no_longer_waiting').slice(0, 500), orderId, URGENT_ALERT_TYPE]
  )
  return true
}

// 订单被骑手转单退回大厅后，把此前因接单而置为 skipped 的紧急单提醒重新排上。
// 为什么必须显式重置：queueUrgentOrderAlert 用的是 INSERT IGNORE，会被 (order_id, notification_type)
// 唯一键静默吞掉；而 skipUrgentOrderAlert 只更新 status IN ('pending','retryable')，不会再碰 skipped 行。
// 表现是「不报错，但邮件永远不再发」——静默失效。WHERE 条件与 queueUrgentOrderAlert 对齐，避免重发已 sent 的。
async function requeueUrgentOrderAlert(executor, orderId, reason) {
  if (!executor || typeof executor.execute !== 'function') throw new TypeError('邮件提醒任务重置器无效')
  if (!config.urgentEmail.enabled) return false
  const [result] = await executor.execute(
    `UPDATE order_notifications n
       JOIN orders o ON o.id = n.order_id
       JOIN platform_settings settings ON settings.id = 1
        SET n.status = 'pending', n.attempts = 0, n.next_attempt_at = NULL,
            n.processing_started_at = NULL, n.sent_at = NULL, n.last_error = ?,
            n.due_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${URGENT_ALERT_DELAY_MINUTES} MINUTE),
            n.updated_at = UTC_TIMESTAMP()
      WHERE n.order_id = ?
        AND n.notification_type = ?
        AND n.status = 'skipped'
        AND o.urgency = 'urgent'
        AND o.status = 'waiting'
        AND o.rider_id IS NULL
        AND (o.paid_amount > 0 OR o.original_price - o.coupon_discount <= 0)
        AND settings.review_mode = 0
        AND settings.service_status = 'open'`,
    [String(reason || 'order_transferred_back').slice(0, 500), orderId, URGENT_ALERT_TYPE]
  )
  return Number(result.affectedRows) > 0
}

module.exports = { queueUrgentOrderAlert, skipUrgentOrderAlert, requeueUrgentOrderAlert }
