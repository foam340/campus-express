const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const express = require('express')
const QRCode = require('qrcode')
const { pool, transaction } = require('../db')
const { asyncRoute, HttpError, ok } = require('../http')
const { authenticateMini } = require('../mini-auth')
const config = require('../config')
const { centsToMoney, moneyToCents, orderPayableCents } = require('../payment-money')
const {
  cancelLockedOrder,
  ensureRefundRecord,
  recordCancelledPayment
} = require('../payment-refunds')
const { createNativePayment, refundOrder, verifyPaymentCallback } = require('../xorpay')
const { queueUrgentOrderAlert } = require('../urgent-alert-queue')
const { queueNewOrderRiderEmail } = require('../rider-notify')

const router = express.Router()
const PAYMENT_TTL_MS = 10 * 60 * 1000
const PAYMENT_NOTIFY_URL = 'https://api.scnutalk.com/mini/payment/callback'
const signingTasks = new Map()

// 清理超过 1 小时的支付二维码图片，避免文件无限堆积（未支付订单 10 分钟即被自动取消）
async function sweepQrDir(qrDir) {
  const cutoff = Date.now() - 60 * 60 * 1000
  let names
  try { names = await fs.readdir(qrDir) } catch (error) { return }
  await Promise.all(names.map(async name => {
    if (!/^[a-f0-9]{32}\.png$/.test(name)) return
    try {
      const stat = await fs.stat(path.join(qrDir, name))
      if (stat.mtimeMs < cutoff) await fs.unlink(path.join(qrDir, name))
    } catch (error) { /* 忽略单文件清理失败 */ }
  }))
}

async function createPaymentSign(orderId, miniUser) {
  const [rows] = await pool.execute(
    `SELECT id, user_id, original_price, coupon_discount, paid_amount, payment_aoid, payment_expires_at, status, created_at
       FROM orders WHERE id = ? LIMIT 1`,
    [orderId]
  )
  const order = rows[0]
  if (!order || String(order.user_id) !== String(miniUser.id)) {
    throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
  }
  if (order.status !== 'unpaid') {
    throw new HttpError(409, '订单当前无需支付，请刷新后查看', 'ORDER_NOT_PAYABLE')
  }
  const payableCents = orderPayableCents(order)
  if (!Number.isSafeInteger(payableCents) || payableCents <= 0) {
    throw new HttpError(409, '订单金额异常，请联系客服处理', 'ORDER_PAYMENT_AMOUNT_INVALID')
  }
  const createdAtMs = order.created_at instanceof Date ? order.created_at.getTime() : Date.parse(order.created_at) || 0
  const existingExpiresAtMs = order.payment_expires_at instanceof Date
    ? order.payment_expires_at.getTime()
    : Date.parse(order.payment_expires_at) || 0
  if ((existingExpiresAtMs && existingExpiresAtMs <= Date.now()) || (!existingExpiresAtMs && createdAtMs + PAYMENT_TTL_MS <= Date.now())) {
    throw new HttpError(409, '订单支付时间已结束，请重新下单', 'ORDER_PAYMENT_EXPIRED')
  }
  // 在请求支付平台前固化首次签单到期时间；同一订单重试时沿用该时间窗。
  await pool.execute(
    `UPDATE orders
        SET payment_expires_at = COALESCE(payment_expires_at, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)),
            updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND user_id = ? AND status = 'unpaid'
        AND COALESCE(payment_expires_at, DATE_ADD(created_at, INTERVAL 10 MINUTE)) > UTC_TIMESTAMP()`,
    [orderId, miniUser.id]
  )
  const [intentRows] = await pool.execute(
    'SELECT status, payment_expires_at FROM orders WHERE id = ? AND user_id = ? LIMIT 1',
    [orderId, miniUser.id]
  )
  const intent = intentRows[0]
  if (!intent || intent.status !== 'unpaid') {
    throw new HttpError(409, '订单状态已变化，请刷新后重试', 'ORDER_PAYMENT_STATE_CHANGED')
  }
  const intentExpiresAtMs = intent.payment_expires_at instanceof Date
    ? intent.payment_expires_at.getTime()
    : Date.parse(intent.payment_expires_at) || 0
  if (!intentExpiresAtMs || intentExpiresAtMs <= Date.now()) {
    throw new HttpError(409, '订单支付时间已结束，请重新下单', 'ORDER_PAYMENT_EXPIRED')
  }
  const price = centsToMoney(payableCents)
  console.log(JSON.stringify({ level: 'info', message: 'xorpay native request', order_id: orderId, price }))
  let result
  try {
    result = await createNativePayment({
      name: `校园代拿-${orderId}`,
      price,
      orderId,
      orderUid: miniUser.id,
      notifyUrl: PAYMENT_NOTIFY_URL,
      expireSeconds: 600
    })
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', message: 'xorpay native request failed', error: error.message }))
    throw new HttpError(502, '支付服务暂不可用，请稍后重试', 'PAYMENT_SERVICE_UNAVAILABLE')
  }
  console.log(JSON.stringify({ level: 'info', message: 'xorpay native response', order_id: orderId, status: result && result.status, aoid: result && result.aoid }))
  if (!result || result.status !== 'ok') {
    const info = (result && result.info) || ''
    console.error(JSON.stringify({ level: 'error', message: 'xorpay native failed', order_id: orderId, provider_status: result && result.status }))
    throw new HttpError(502, info || '支付异常，请重试', 'PAYMENT_FAILED')
  }
  const qrUrl = (result.info && result.info.qr) || ''
  const aoid = String(result.aoid || '').trim()
  if (!qrUrl || !aoid) {
    throw new HttpError(502, '未获取到支付二维码', 'PAYMENT_QR_MISSING')
  }

  await pool.execute(
    `UPDATE orders
        SET payment_aoid = ?, updated_at = UTC_TIMESTAMP()
      WHERE id = ? AND user_id = ? AND status = 'unpaid'
        AND (payment_aoid IS NULL OR payment_aoid = '' OR payment_aoid = ?)`,
    [aoid, orderId, miniUser.id, aoid]
  )
  const [currentRows] = await pool.execute(
    'SELECT status, payment_aoid, payment_expires_at FROM orders WHERE id = ? AND user_id = ? LIMIT 1',
    [orderId, miniUser.id]
  )
  const current = currentRows[0]
  if (!current || !['unpaid', 'waiting'].includes(current.status) || String(current.payment_aoid || '') !== aoid) {
    throw new HttpError(409, '订单状态已变化，请刷新后重试', 'ORDER_PAYMENT_STATE_CHANGED')
  }

  // 生成二维码 PNG 并落盘；二维码仅用于保存后在微信扫一扫中支付。
  const qrBuffer = await QRCode.toBuffer(qrUrl, { width: 400, margin: 2, type: 'png' })
  const qrDir = path.join(config.uploadDir, 'qr')
  const qrFileName = `${crypto.randomBytes(16).toString('hex')}.png`
  await fs.mkdir(qrDir, { recursive: true, mode: 0o750 })
  await fs.writeFile(path.join(qrDir, qrFileName), qrBuffer, { mode: 0o640 })
  await sweepQrDir(qrDir)
  const qrImageUrl = `/mini/payment/qr/${qrFileName}`
  const qrImage = `data:image/png;base64,${qrBuffer.toString('base64')}`
  const expiresAt = current.payment_expires_at instanceof Date
    ? current.payment_expires_at.getTime()
    : Date.parse(current.payment_expires_at) || intentExpiresAtMs
  return { qrCode: qrUrl, qrImage, qrImageUrl, order_id: orderId, expiresAt }
}

// POST /mini/payment/sign — native 扫码支付；金额始终从订单快照重新计算。
router.post('/payment/sign', authenticateMini, asyncRoute(async (request, response) => {
  const orderId = String(request.body && request.body.orderId || '').trim()
  if (!orderId || orderId.length > 32) {
    throw new HttpError(400, '订单号无效', 'INVALID_PAYMENT_PARAMS')
  }
  const taskKey = `${request.miniUser.id}:${orderId}`
  let task = signingTasks.get(taskKey)
  if (!task) {
    task = createPaymentSign(orderId, request.miniUser).finally(() => signingTasks.delete(taskKey))
    signingTasks.set(taskKey, task)
  }
  return ok(response, await task)
}))

// POST /mini/payment/callback — XorPay 异步通知
router.post('/payment/callback', asyncRoute(async (request, response) => {
  const body = request.body || {}
  const { aoid, order_id, pay_price, pay_time, sign } = body
  const actualCents = moneyToCents(pay_price)
  if (!order_id || !aoid || !sign || !Number.isSafeInteger(actualCents) || actualCents <= 0) {
    response.status(400).send('fail')
    return
  }
  if (!verifyPaymentCallback(body)) {
    console.error(JSON.stringify({ level: 'error', message: 'xorpay callback sign mismatch', order_id, aoid }))
    response.status(400).send('fail')
    return
  }
  console.log(JSON.stringify({ level: 'info', message: 'xorpay callback received', order_id, aoid, pay_price }))
  await transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT id, user_id, status, original_price, coupon_discount, paid_amount, payment_aoid
         FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [order_id]
    )
    const order = rows[0]
    if (!order) throw new HttpError(404, '支付订单不存在', 'PAYMENT_ORDER_NOT_FOUND')
    const expectedCents = orderPayableCents(order)
    const storedAoid = String(order.payment_aoid || '').trim()
    const amountMatches = expectedCents === actualCents && actualCents > 0
    // XorPay 回调极端情况下可能先于签单响应写回 aoid；有效签名且金额一致时允许首次绑定。
    const aoidMatches = !storedAoid || storedAoid === String(aoid)
    const paidCents = moneyToCents(order.paid_amount) || 0

    if (amountMatches && aoidMatches) {
      if (order.status === 'cancelled') {
        await recordCancelledPayment(connection, order, {
          amountCents: actualCents,
          paymentAoid: aoid,
          reason: 'late_payment'
        })
        return
      }
      if (paidCents > 0) {
        if (paidCents !== actualCents) {
          throw new HttpError(409, '支付金额记录冲突', 'PAYMENT_RECORD_CONFLICT')
        }
        return
      }
      if (!['unpaid', 'waiting'].includes(order.status)) {
        throw new HttpError(409, '订单状态与支付记录不一致', 'PAYMENT_STATE_CONFLICT')
      }
      await connection.execute(
        `UPDATE orders
            SET status = 'waiting', paid_amount = ?,
                payment_aoid = COALESCE(NULLIF(payment_aoid, ''), ?), updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [centsToMoney(actualCents), aoid, order_id]
      )
      await connection.execute(
        "UPDATE user_coupons SET status = 'used', used_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE used_order_id = ? AND status = 'available'",
        [order_id]
      )
      await queueUrgentOrderAlert(connection, order_id)
      await queueNewOrderRiderEmail(connection, order_id)
      return
    }

    if (['unpaid', 'waiting'].includes(order.status)) {
      await cancelLockedOrder(connection, order, 'amount_mismatch', {
        paidAmountCents: actualCents,
        paymentAoid: aoid
      })
      return
    }
    if (order.status === 'cancelled') {
      await recordCancelledPayment(connection, order, {
        amountCents: actualCents,
        paymentAoid: aoid,
        reason: amountMatches ? 'late_payment' : 'amount_mismatch'
      })
      return
    }

    const refund = await ensureRefundRecord(connection, {
      orderId: order.id,
      paymentAoid: aoid,
      amountCents: actualCents,
      reason: 'amount_mismatch'
    })
    if (refund && refund.status !== 'succeeded') {
      await connection.execute(
        "UPDATE order_refunds SET status = 'manual_review', last_error = '进行中订单收到异常支付回调，需要人工核对', updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [refund.id]
      )
    }
    if (!['completed', 'disputed'].includes(order.status)) {
      await connection.execute("UPDATE orders SET status = 'disputed', updated_at = UTC_TIMESTAMP() WHERE id = ?", [order.id])
    }
  })
  console.log(JSON.stringify({ level: 'info', message: 'native payment confirmed', order_id, pay_price }))
  response.send('success')
}))

// GET /mini/payment/qr/:file — 公开返回支付二维码图片（供小程序长按「识别图中二维码」）
router.get('/payment/qr/:file', asyncRoute(async (request, response) => {
  const file = String(request.params.file || '')
  if (!/^[a-f0-9]{32}\.png$/.test(file)) throw new HttpError(404, '二维码不存在', 'PAYMENT_QR_NOT_FOUND')
  let buffer
  try {
    buffer = await fs.readFile(path.join(config.uploadDir, 'qr', file))
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new HttpError(404, '二维码不存在或已过期', 'PAYMENT_QR_NOT_FOUND')
    throw error
  }
  response.type('image/png')
  response.setHeader('Cache-Control', 'public, max-age=300')
  return response.send(buffer)
}))

module.exports = router
module.exports.refundOrder = refundOrder
