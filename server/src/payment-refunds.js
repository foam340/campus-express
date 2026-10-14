const { pool, transaction } = require('./db')
const { HttpError } = require('./http')
const { centsToMoney, moneyToCents } = require('./payment-money')
const { refundOrder } = require('./xorpay')
const { skipUrgentOrderAlert } = require('./urgent-alert-queue')

const RETRYABLE_PROVIDER_STATUSES = new Set(['alipay_api_error', 'wechat_api_error', 'wxpay_api_error'])
const MAX_AUTOMATIC_ATTEMPTS = 3

function mapRefund(row) {
  if (!row) return null
  return {
    id: String(row.id),
    orderId: row.order_id,
    paymentAoid: row.payment_aoid || '',
    amount: Number(row.amount) || 0,
    reason: row.reason || '',
    status: row.status || '',
    attempts: Number(row.attempts) || 0,
    lastError: row.last_error || ''
  }
}

async function findRefund(executor, orderId, lock = false) {
  const [rows] = await executor.execute(
    `SELECT id, order_id, payment_aoid, amount, reason, status, attempts, last_error,
            next_retry_at, processing_started_at, succeeded_at, created_at, updated_at
       FROM order_refunds
      WHERE order_id = ?
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [orderId]
  )
  return rows[0] || null
}

async function releaseOrderCoupons(connection, orderId, userId) {
  const values = [orderId]
  const userCondition = userId == null ? '' : ' AND user_id = ?'
  if (userId != null) values.push(userId)
  const [coupons] = await connection.execute(
    `SELECT id, campaign_id
       FROM user_coupons
      WHERE used_order_id = ?${userCondition}
        AND status IN ('used', 'available')
      FOR UPDATE`,
    values
  )
  for (const coupon of coupons) {
    await connection.execute(
      "UPDATE user_coupons SET status = 'available', used_order_id = NULL, used_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?",
      [coupon.id]
    )
    if (coupon.campaign_id) {
      await connection.execute(
        'UPDATE coupon_campaigns SET used_count = GREATEST(used_count - 1, 0), updated_at = UTC_TIMESTAMP() WHERE id = ?',
        [coupon.campaign_id]
      )
    }
  }
}

async function ensureRefundRecord(connection, input) {
  const orderId = String(input.orderId || '')
  const aoid = String(input.paymentAoid || '').trim() || null
  const amountCents = Number(input.amountCents)
  if (!orderId || !Number.isSafeInteger(amountCents) || amountCents <= 0) return null

  const initialStatus = aoid ? 'pending' : 'manual_review'
  const initialError = aoid ? '' : '订单已有实付金额，但缺少 XorPay 平台订单号'
  await connection.execute(
    `INSERT INTO order_refunds
       (order_id, payment_aoid, amount, reason, status, attempts, last_error,
        next_retry_at, processing_started_at, succeeded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, UTC_TIMESTAMP(), NULL, NULL, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE updated_at = updated_at`,
    [orderId, aoid, centsToMoney(amountCents), String(input.reason || 'unknown').slice(0, 40), initialStatus, initialError]
  )

  let current = await findRefund(connection, orderId, true)
  const currentAmountCents = moneyToCents(current.amount)
  if (currentAmountCents !== amountCents) {
    await connection.execute(
      "UPDATE order_refunds SET status = 'manual_review', last_error = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status != 'succeeded'",
      [`同一订单出现不同退款金额：已有${centsToMoney(currentAmountCents || 0)}，新金额${centsToMoney(amountCents)}`.slice(0, 500), current.id]
    )
  } else if (current.payment_aoid && aoid && current.payment_aoid !== aoid) {
    await connection.execute(
      "UPDATE order_refunds SET status = 'manual_review', last_error = ?, updated_at = UTC_TIMESTAMP() WHERE id = ? AND status != 'succeeded'",
      ['同一订单出现不同 XorPay 平台订单号'.slice(0, 500), current.id]
    )
  } else if (!current.payment_aoid && aoid && current.status !== 'succeeded') {
    await connection.execute(
      `UPDATE order_refunds
          SET payment_aoid = ?, status = 'pending', last_error = '', next_retry_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [aoid, current.id]
    )
  }
  current = await findRefund(connection, orderId, true)
  return current
}

async function cancelLockedOrder(connection, order, reason, overrides = {}) {
  const paidAmountCents = Number.isSafeInteger(overrides.paidAmountCents)
    ? overrides.paidAmountCents
    : (moneyToCents(order.paid_amount) || 0)
  const paymentAoid = String(overrides.paymentAoid || order.payment_aoid || '').trim()

  await connection.execute(
    `UPDATE orders
        SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, UTC_TIMESTAMP()),
            paid_amount = ?, payment_aoid = COALESCE(NULLIF(payment_aoid, ''), ?), updated_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [centsToMoney(paidAmountCents), paymentAoid || null, order.id]
  )
  await skipUrgentOrderAlert(connection, order.id, `order_cancelled:${reason}`)
  await releaseOrderCoupons(connection, order.id, order.user_id)
  // 取消订单时联动关闭该订单未结的售后单，避免售后记录残留为“孤儿”（售后单只在订单进入 disputed 后产生，故 waiting/unpaid 取消时无匹配行，安全）
  await connection.execute(
    `UPDATE after_sales
        SET status = 'resolved', resolution = '订单已取消退款，售后自动关闭',
            compensation_amount = 0, resolved_by = NULL,
            resolved_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
      WHERE order_id = ? AND status IN ('open', 'processing')`,
    [order.id]
  )
  const refund = paidAmountCents > 0
    ? await ensureRefundRecord(connection, {
      orderId: order.id,
      paymentAoid,
      amountCents: paidAmountCents,
      reason
    })
    : null
  return { orderId: order.id, refund: mapRefund(refund) }
}

async function cancelUserOrder(orderId, userId) {
  return transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT id, user_id, status, deadline_at, paid_amount, payment_aoid
         FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [orderId]
    )
    const order = rows[0]
    if (!order || String(order.user_id) !== String(userId)) {
      throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
    }
    if (order.status === 'cancelled') {
      return { orderId, refund: mapRefund(await findRefund(connection, orderId, true)), alreadyCancelled: true }
    }
    if (!['waiting', 'unpaid'].includes(order.status)) {
      throw new HttpError(409, '订单已被接单，请联系管理员取消', 'ORDER_CANNOT_CANCEL')
    }
    return cancelLockedOrder(connection, order, 'user_cancel')
  })
}

async function recordCancelledPayment(connection, order, input) {
  const amountCents = Number(input.amountCents)
  const paymentAoid = String(input.paymentAoid || '').trim()
  const existingAoid = String(order.payment_aoid || '').trim()
  const aoidConflict = Boolean(existingAoid && paymentAoid && existingAoid !== paymentAoid)

  await connection.execute(
    `UPDATE orders
        SET paid_amount = ?, payment_aoid = COALESCE(NULLIF(payment_aoid, ''), ?), updated_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [centsToMoney(amountCents), paymentAoid || null, order.id]
  )
  const refund = await ensureRefundRecord(connection, {
    orderId: order.id,
    paymentAoid,
    amountCents,
    reason: input.reason || 'late_payment'
  })
  if (aoidConflict && refund && refund.status !== 'succeeded') {
    await connection.execute(
      "UPDATE order_refunds SET status = 'manual_review', last_error = '支付回调平台订单号与签单记录不一致', updated_at = UTC_TIMESTAMP() WHERE id = ?",
      [refund.id]
    )
  }
  return findRefund(connection, order.id, true)
}

async function claimRefundByOrderId(orderId) {
  return transaction(async connection => {
    const refund = await findRefund(connection, orderId, true)
    if (!refund || !['pending', 'retryable'].includes(refund.status)) return null
    if (refund.next_retry_at && new Date(refund.next_retry_at).getTime() > Date.now()) return null
    if (!refund.payment_aoid) {
      await connection.execute(
        "UPDATE order_refunds SET status = 'manual_review', last_error = '缺少 XorPay 平台订单号', updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [refund.id]
      )
      return null
    }
    await connection.execute(
      `UPDATE order_refunds
          SET status = 'processing', attempts = attempts + 1, processing_started_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [refund.id]
    )
    return findRefund(connection, orderId, true)
  })
}

async function finishRefundAttempt(refund, status, message, retryDelaySeconds = 0) {
  const nextRetrySql = status === 'retryable'
    ? `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${Math.max(1, Number(retryDelaySeconds) || 60)} SECOND)`
    : 'NULL'
  await pool.execute(
    `UPDATE order_refunds
        SET status = ?, last_error = ?, next_retry_at = ${nextRetrySql},
            succeeded_at = CASE WHEN ? = 'succeeded' THEN UTC_TIMESTAMP() ELSE succeeded_at END,
            updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND status = 'processing'`,
    [status, String(message || '').slice(0, 500), status, refund.id]
  )
  return mapRefund(await findRefund(pool, refund.order_id))
}

async function processRefundByOrderId(orderId) {
  const refund = await claimRefundByOrderId(orderId)
  if (!refund) return mapRefund(await findRefund(pool, orderId))
  try {
    const result = await refundOrder(refund.payment_aoid, centsToMoney(moneyToCents(refund.amount)))
    if (result && result.status === 'ok') {
      console.log(JSON.stringify({ level: 'info', message: 'xorpay refund success', order_id: orderId, refund_id: refund.id }))
      return finishRefundAttempt(refund, 'succeeded', '')
    }
    const providerStatus = String(result && result.status || 'unknown')
    const providerInfo = String(result && result.info || '')
    const canRetry = RETRYABLE_PROVIDER_STATUSES.has(providerStatus) && Number(refund.attempts) < MAX_AUTOMATIC_ATTEMPTS
    console.error(JSON.stringify({ level: 'error', message: 'xorpay refund rejected', order_id: orderId, refund_id: refund.id, provider_status: providerStatus }))
    return finishRefundAttempt(
      refund,
      canRetry ? 'retryable' : 'manual_review',
      `${providerStatus}${providerInfo ? `: ${providerInfo}` : ''}`,
      Math.pow(5, Math.max(1, Number(refund.attempts))) * 60
    )
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'xorpay refund ambiguous', order_id: orderId, refund_id: refund.id, error: error.message }))
    return finishRefundAttempt(refund, 'manual_review', `退款请求结果不确定：${error.message}`)
  }
}

async function processPendingRefunds(limit = 20) {
  await pool.execute(
    `UPDATE order_refunds
        SET status = 'manual_review', last_error = '退款处理中断，结果需要人工核对', updated_at = UTC_TIMESTAMP()
      WHERE status = 'processing' AND processing_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)`
  )
  const [rows] = await pool.execute(
    `SELECT order_id
       FROM order_refunds
      WHERE status IN ('pending', 'retryable')
        AND (next_retry_at IS NULL OR next_retry_at <= UTC_TIMESTAMP())
      ORDER BY created_at ASC
      LIMIT ?`,
    [Math.max(1, Math.min(100, Number(limit) || 20))]
  )
  for (const row of rows) await processRefundByOrderId(row.order_id)
}

module.exports = {
  cancelLockedOrder,
  cancelUserOrder,
  ensureRefundRecord,
  findRefund,
  mapRefund,
  processPendingRefunds,
  processRefundByOrderId,
  recordCancelledPayment,
  releaseOrderCoupons
}
