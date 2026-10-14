const { request } = require('./request')
const { uploadPickupFiles, uploadDeliveryFiles } = require('./upload')
const { apiBaseUrl } = require('../config/index')
const { BUSINESS, CAMPUSES } = require('../config/constants')

function listMyOrders() {
  return request({ url: '/mini/orders', showLoading: false, cacheKey: 'remote_my_orders' })
    .then(data => Array.isArray(data && data.items) ? data.items : [])
}
function getCurrentUser() { return request({ url: '/mini/me', showLoading: false }).then(data => data && data.user ? data.user : null) }
function getOrder(id) { return request({ url: `/mini/orders/${encodeURIComponent(id)}`, showLoading: false }).then(data => data && data.order ? data : null) }
function listCoupons() { return request({ url: '/mini/coupons', showLoading: false }).then(data => Array.isArray(data && data.items) ? data.items : []) }
function getHomeOverview() {
  return request({ url: '/mini/home', showLoading: false, cacheKey: 'remote_home_overview' }).then(data => ({
    orders: Array.isArray(data && data.orders) ? data.orders : [],
    coupons: Array.isArray(data && data.coupons) ? data.coupons : [],
    settings: data && data.settings && typeof data.settings === 'object' ? data.settings : {}
  }))
}
function redeemCoupon(code) { return request({ url: '/mini/coupons/redeem', method: 'POST', data: { code }, idempotent: true }).then(data => data && data.coupon ? data.coupon : null) }

function createOrder(payload) {
  const input = payload || {}
  if (Array.isArray(input.items)) {
    const items = input.items.filter(item => item && item.image && item.scope && item.size).slice(0, 8)
    if (!items.length || items.length !== input.items.length) return Promise.reject(new Error('ORDER_ITEMS_INCOMPLETE'))
    return uploadPickupFiles(items.map(item => item.image)).then(uploadIds => {
      const data = {
        items: items.map((item, index) => ({ scope: item.scope, size: item.size, uploadId: uploadIds[index] })),
        urgency: input.urgency,
        noUpstairs: !input.toDoor,
        note: input.note || '',
        couponId: input.couponId || '',
        pricingVersion: Math.max(0, Math.floor(Number(input.pricingVersion) || 0)),
        quotedTotal: Math.max(0, Number(input.quotedTotal) || 0)
      }
      // 石牌校区附加字段：取件驿站 + 楼栋 + 房号；南海不传、后端忽略。
      if (input.pickupStation) data.pickupStation = input.pickupStation
      if (input.building) data.building = input.building
      if (input.room) data.room = input.room
      return request({ url: '/mini/orders', method: 'POST', idempotent: true, data, errorMessage: 'ORDER_CREATE_FAILED' })
    }).then(data => data && data.order ? data.order : null)
  }
  const paths = Array.isArray(input.images) ? input.images.filter(Boolean).slice(0, BUSINESS.maxUploadImages) : []
  if (!paths.length) return Promise.reject(new Error('PICKUP_IMAGE_REQUIRED'))
  return uploadPickupFiles(paths).then(uploadIds => request({
    url: '/mini/orders', method: 'POST', idempotent: true,
    // 前端语义已改为「送到宿舍门口」(toDoor)；后端仍是 no_upstairs（true=不送上楼、-1 元）。方向相反，故取反发送：
    // 送到门口 → no_upstairs=false；楼下自取 → no_upstairs=true。后端字段语义翻转前，此取反必须保留。
    data: { urgency: input.urgency, scope: input.scope, pieces: input.pieces, isLarge: !!input.isLarge, noUpstairs: !input.toDoor, note: input.note || '', couponId: input.couponId || '', uploadIds },
    errorMessage: 'ORDER_CREATE_FAILED'
  })).then(data => data && data.order ? data.order : null)
}

function cancelOrder(id) {
  return request({ url: `/mini/orders/${encodeURIComponent(id)}/cancel`, method: 'POST', data: {}, idempotent: true })
    .then(data => ({ order: data && data.order, refund: data && data.refund || null }))
}
function confirmReceipt(id) { return request({ url: `/mini/orders/${encodeURIComponent(id)}/confirm-receipt`, method: 'POST', data: {}, idempotent: true }).then(data => data.order) }
function reportMissing(id) { return request({ url: `/mini/orders/${encodeURIComponent(id)}/report-missing`, method: 'POST', data: {}, idempotent: true }).then(data => data.order) }

function applyRider(payload) {
  return request({ url: '/mini/rider/applications', method: 'POST', data: payload || {}, idempotent: true }).then(data => data && data.application ? data.application : null)
}
function listRiderHall() { return request({ url: '/mini/rider/hall', showLoading: false }).then(data => data || { items: [], activeCount: 0 }) }
function acceptOrder(id) { return request({ url: `/mini/rider/orders/${encodeURIComponent(id)}/accept`, method: 'POST', idempotent: true, data: {} }).then(data => data.order) }
// 骑手转单：把已接单未取件的单放回接单大厅。
function transferOrder(id, reason) {
  return request({ url: `/mini/rider/orders/${encodeURIComponent(id)}/transfer`, method: 'POST', idempotent: true, data: { reason: reason || '' } })
    .then(data => data && data.order)
}
function listRiderTasks() {
  return request({ url: '/mini/rider/tasks', showLoading: false }).then(data => ({
    items: Array.isArray(data && data.items) ? data.items : [],
    riderProgress: data && data.riderProgress && typeof data.riderProgress === 'object' ? data.riderProgress : null
  }))
}
function updateRiderStatus(id, action, deliveryImages) {
  const paths = Array.isArray(deliveryImages) ? deliveryImages.filter(Boolean).slice(0, 3) : []
  const uploadPromise = action === 'delivered' ? uploadDeliveryFiles(paths) : Promise.resolve([])
  return uploadPromise.then(deliveryUploadIds => request({
    url: `/mini/rider/orders/${encodeURIComponent(id)}/status`, method: 'POST', idempotent: true,
    data: { action, deliveryUploadIds }
  })).then(data => data.order)
}
function getRiderWallet() { return request({ url: '/mini/rider/wallet', showLoading: false }).then(data => data || { balance: {}, records: [] }) }
function requestWithdrawal(amount) { return request({ url: '/mini/rider/withdrawals', method: 'POST', idempotent: true, data: { amount } }).then(data => data && data.withdrawal ? data.withdrawal : null) }
function getPaymentSign(orderId) {
  return request({ url: '/mini/payment/sign', method: 'POST', data: { orderId }, idempotent: true }).then(data => {
    if (!data) return null
    if (data.qrImageUrl && !/^https:\/\//.test(data.qrImageUrl) && apiBaseUrl) {
      data.qrImageUrl = `${apiBaseUrl.replace(/\/$/, '')}/${String(data.qrImageUrl).replace(/^\//, '')}`
    }
    return data
  })
}
function submitFeedback(payload) { return request({ url: '/mini/feedback', method: 'POST', idempotent: true, data: payload || {} }).then(data => data || null) }
function getMiniSettings(campus) {
  const query = campus && campus !== CAMPUSES[0] ? '?campus=' + encodeURIComponent(campus) : ''
  return request({ url: `/mini/settings${query}`, showLoading: false, skipAuth: true }).then(data => ({
    reviewMode: data && typeof data.reviewMode === 'boolean' ? data.reviewMode : true,
    serviceStatus: data && data.serviceStatus === 'closed' ? 'closed' : 'open',
    serviceNotice: (data && typeof data.serviceNotice === 'string' ? data.serviceNotice : '') || '',
    observationHours: Math.max(1, Number(data && data.observationHours) || 24),
    itemPricing: data && data.itemPricing && typeof data.itemPricing === 'object' ? data.itemPricing : null
  }))
}
// 骑手收新单通知邮箱（可选，留空=不接收）；存 riders.email。返回 { email, warning }。
function updateRiderEmail(email) {
  return request({ url: '/mini/rider/email', method: 'POST', idempotent: true, data: { email: email || '' } })
    .then(data => {
      const saved = (data && (typeof data.riderEmail === 'string' ? data.riderEmail : (typeof data.email === 'string' ? data.email : ''))) || email || ''
      const warning = (data && data.warning) || ''
      return { email: saved, warning }
    })
}
// 申请变更校区：提交后老板在管理台审核，通过才生效。
function submitCampusChange(payload) {
  return request({ url: '/mini/campus-change-requests', method: 'POST', idempotent: true, data: payload || {} })
    .then(data => data && data.request ? data.request : null)
}
function listCampusChangeRequests() {
  return request({ url: '/mini/campus-change-requests', showLoading: false })
    .then(data => Array.isArray(data && data.items) ? data.items : [])
}

module.exports = {
  listMyOrders, getCurrentUser, getOrder, listCoupons, getHomeOverview, redeemCoupon, createOrder, cancelOrder, confirmReceipt, reportMissing,
  applyRider, listRiderHall, acceptOrder, transferOrder, listRiderTasks, updateRiderStatus, getRiderWallet, requestWithdrawal,
  getPaymentSign, submitFeedback, getMiniSettings, updateRiderEmail, submitCampusChange, listCampusChangeRequests
}
