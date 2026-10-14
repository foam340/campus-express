const URGENT_ALERT_TYPE = 'urgent_unaccepted_30m'
const URGENT_ALERT_DELAY_MINUTES = 30
const URGENT_ALERT_SCAN_INTERVAL_MS = 10 * 60 * 1000
const URGENT_ALERT_RETRY_DELAY_MINUTES = 10
const URGENT_ALERT_MAX_ATTEMPTS = 3

function buildUrgentAlertDetails(order) {
  const orderId = String(order && order.id || '').replace(/[^a-zA-Z0-9_-]/g, '')
  return {
    order: orderId.slice(-8),
    building: String(order && order.building || '未知').replace(/[\r\n]+/g, ' ').slice(0, 12),
    minutes: String(URGENT_ALERT_DELAY_MINUTES)
  }
}

function buildUrgentAlertEmail(order, adminUrl) {
  const details = buildUrgentAlertDetails(order)
  const safeAdminUrl = String(adminUrl || '').replace(/[\r\n]/g, '').slice(0, 300)
  return {
    subject: `[校园代拿] 很急订单 ${details.order} 等待超时`,
    text: [
      `很急订单 ${details.order} 已等待 ${details.minutes} 分钟无人接单。`,
      `收货楼栋：${details.building}`,
      '',
      '请登录管理平台确认订单当前状态：',
      safeAdminUrl
    ].join('\n')
  }
}

function hasCompletedPayment(order) {
  const paidAmount = Number(order && order.paid_amount)
  const originalPrice = Number(order && order.original_price)
  const couponDiscount = Number(order && order.coupon_discount)
  return paidAmount > 0 || (
    Number.isFinite(originalPrice) &&
    Number.isFinite(couponDiscount) &&
    originalPrice - couponDiscount <= 0
  )
}

module.exports = Object.freeze({
  URGENT_ALERT_TYPE,
  URGENT_ALERT_DELAY_MINUTES,
  URGENT_ALERT_SCAN_INTERVAL_MS,
  URGENT_ALERT_RETRY_DELAY_MINUTES,
  URGENT_ALERT_MAX_ATTEMPTS,
  buildUrgentAlertDetails,
  buildUrgentAlertEmail,
  hasCompletedPayment
})
