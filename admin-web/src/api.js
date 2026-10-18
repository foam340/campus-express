import { request } from './request.js'
import { queryString } from './format.js'

export const adminApi = {
  login(credentials) {
    return request({ url: '/admin/auth/login', method: 'POST', data: credentials, skipAuth: true })
  },
  dashboard(campus) {
    return request({ url: `/admin/dashboard${queryString({ campus })}` })
  },
  trend(campus) {
    return request({ url: `/admin/dashboard/trend${queryString({ campus })}` })
  },
  income(campus) {
    return request({ url: `/admin/dashboard/income${queryString({ campus })}` })
  },
  ledgerEntries(filters, campus) {
    return request({ url: `/admin/ledger-entries${queryString({ ...filters, campus })}` })
  },
  createLedgerEntry(data, campus) {
    return request({ url: `/admin/ledger-entries${queryString({ campus })}`, method: 'POST', idempotent: true, data })
  },
  updateLedgerEntry(id, data, campus) {
    return request({ url: `/admin/ledger-entries/${encodeURIComponent(id)}/update${queryString({ campus })}`, method: 'POST', idempotent: true, data })
  },
  // 删除走 POST /:id/delete 而不是 HTTP DELETE：这个项目的 CORS 白名单只放行
  // GET/POST/PUT/OPTIONS，DELETE 会被浏览器预检拦掉。
  deleteLedgerEntry(id, campus) {
    return request({ url: `/admin/ledger-entries/${encodeURIComponent(id)}/delete${queryString({ campus })}`, method: 'POST', idempotent: true, data: {} })
  },
  orders(filters, campus) {
    return request({ url: `/admin/orders${queryString({ ...filters, campus })}` })
  },
  orderAttachments(orderId) {
    return request({ url: `/admin/orders/${encodeURIComponent(orderId)}/attachments` })
  },
  orderAttachment(orderId, attachmentId, download = false) {
    const suffix = download ? '?download=1' : ''
    return request({
      url: `/admin/orders/${encodeURIComponent(orderId)}/attachments/${encodeURIComponent(attachmentId)}${suffix}`,
      responseType: 'blob'
    })
  },
  cancelOrder(orderId) {
    return request({ url: `/admin/orders/${encodeURIComponent(orderId)}/cancel`, method: 'POST', idempotent: true })
  },
  withholdRiderIncome(orderId) {
    return request({ url: `/admin/orders/${encodeURIComponent(orderId)}/withhold-rider-income`, method: 'POST', idempotent: true, data: {} })
  },
  riderOverview(campus) {
    return request({ url: `/admin/riders/overview${queryString({ campus })}` })
  },
  reviewApplication(id, approved, reason) {
    return request({ url: `/admin/rider-applications/${encodeURIComponent(id)}/review`, method: 'POST', idempotent: true, data: { approved, reason } })
  },
  setRiderStatus(id, action, reason) {
    return request({ url: `/admin/riders/${encodeURIComponent(id)}/${action}`, method: 'POST', idempotent: true, data: { reason } })
  },
  setRiderNameNote(id, nameNote) {
    return request({ url: `/admin/riders/${encodeURIComponent(id)}/name-note`, method: 'POST', idempotent: true, data: { nameNote } })
  },
  setRiderGender(id, gender) {
    return request({ url: `/admin/riders/${encodeURIComponent(id)}/gender`, method: 'POST', idempotent: true, data: { gender } })
  },
  setRiderPhone(id, phone) {
    return request({ url: `/admin/riders/${encodeURIComponent(id)}/phone`, method: 'POST', idempotent: true, data: { phone } })
  },
  afterSales(campus) {
    return request({ url: `/admin/after-sales${queryString({ campus })}` })
  },
  resolveAfterSale(id, resolution, compensationAmount) {
    return request({ url: `/admin/after-sales/${encodeURIComponent(id)}/resolve`, method: 'POST', idempotent: true, data: { resolution, compensationAmount } })
  },
  convertAfterSaleToCompleted(id) {
    return request({ url: `/admin/after-sales/${encodeURIComponent(id)}/convert-completed`, method: 'POST', idempotent: true, data: {} })
  },
  feedbacks(campus) {
    return request({ url: `/admin/feedbacks${queryString({ campus })}` })
  },
  setFeedbackStatus(id, status) {
    return request({ url: `/admin/feedbacks/${encodeURIComponent(id)}/status`, method: 'POST', idempotent: true, data: { status } })
  },
  couponOverview(campus) {
    return request({ url: `/admin/coupons/overview${queryString({ campus })}` })
  },
  grantCoupon(data, campus) {
    return request({ url: `/admin/coupons/grants${queryString({ campus })}`, method: 'POST', idempotent: true, data })
  },
  createCouponCode(data, campus) {
    return request({ url: `/admin/coupon-codes${queryString({ campus })}`, method: 'POST', idempotent: true, data })
  },
  withdrawals(campus) {
    return request({ url: `/admin/withdrawals${queryString({ campus })}` })
  },
  reviewWithdrawal(id, approved, reason) {
    return request({ url: `/admin/withdrawals/${encodeURIComponent(id)}/review`, method: 'POST', idempotent: true, data: { approved, reason } })
  },
  settings(campus) {
    return request({ url: `/admin/settings${queryString({ campus })}` })
  },
  updateSettings(data) {
    return request({ url: '/admin/settings', method: 'PUT', idempotent: true, data })
  },
  updateOperational(data) {
    return request({ url: '/admin/settings/operational', method: 'PUT', idempotent: true, data })
  },
  updateServiceStatus(data) {
    return request({ url: '/admin/settings/service-status', method: 'PUT', idempotent: true, data })
  },
  // 审核模式是独立开关，不走 PUT /settings。该路由没有幂等中间件，所以带上的 Idempotency-Key 服务端会忽略；
  // 这里写 idempotent:true 是为了拿到网络失败重试，且与文件内其他 POST 写法一致。
  setReviewMode(enabled) {
    return request({ url: '/admin/settings/review-mode', method: 'POST', idempotent: true, data: { enabled } })
  }
}
