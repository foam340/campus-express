const createPage = require('../../../utils/page')
const orderApi = require('../../../utils/order-api')
const store = require('../../../utils/store')
const { formatExpiryDate } = require('../../../utils/format')

const TABS = [
  { key: 'available', label: '可使用' },
  { key: 'used', label: '已使用' },
  { key: 'expired', label: '已过期' }
]

const STATUS_TEXT = { available: '可使用', used: '已使用', expired: '已过期', cancelled: '已作废' }

function normalizeStatus(item) {
  const status = item && item.status === 'cancelled' ? 'expired' : String(item && item.status || 'expired')
  return Object.assign({}, item, { status })
}

function enrichCoupon(item) {
  return Object.assign({}, item, {
    ruleText: Number(item.minSpend || 0) > 0 ? '满' + item.minSpend + '元可用' : '无门槛',
    expireText: item.expiresAtMs ? '有效期至' + formatExpiryDate(item.expiresAtMs) : '',
    statusText: STATUS_TEXT[item.status] || item.status || ''
  })
}

createPage({
  data: { tabs: TABS, activeTab: 'available', coupons: [], displayCoupons: [], counts: { available: 0, used: 0, expired: 0 }, redeemInput: '', redeeming: false, reviewMode: true },
  onLoad() { this.redeemCodeValue = '' },
  onShow() { this.setData({ reviewMode: store.getSettings().reviewMode !== false }); this.refresh() },
  refresh() {
    orderApi.listCoupons().then(items => {
      const coupons = items.map(item => enrichCoupon(normalizeStatus(item)))
      const counts = { available: 0, used: 0, expired: 0 }
      coupons.forEach(item => { if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1 })
      this.setData({ coupons, counts, tabs: TABS.map(item => Object.assign({}, item, { count: counts[item.key] })), displayCoupons: coupons.filter(item => item.status === this.data.activeTab) })
    }).catch(error => wx.showToast({ title: String(error && error.message || 'COUPON_LOAD_FAILED').slice(0, 20), icon: 'none' }))
  },
  switchTab(event) {
    const activeTab = String(event.currentTarget.dataset.key || 'available')
    if (TABS.some(item => item.key === activeTab)) this.setData({ activeTab, displayCoupons: this.data.coupons.filter(item => item.status === activeTab) })
  },
  inputCode(event) { this.redeemCodeValue = String(event.detail.value || '').trim().toUpperCase().slice(0, 40) },
  redeem() {
    if (this.data.redeeming) return
    const code = this.redeemCodeValue
    if (!code) { wx.showToast({ title: '请输入兑换码', icon: 'none' }); return }
    this.setData({ redeeming: true })
    orderApi.redeemCoupon(code).then(coupon => {
      this.redeemCodeValue = ''
      this.setData({ redeemInput: '', activeTab: 'available' })
      this.refresh()
      wx.showModal({ title: '兑换成功', content: `${coupon && coupon.name || '优惠券'} 已放入券包，结算时可直接使用。`, showCancel: false, confirmText: '知道了' })
    }).catch(error => wx.showToast({ title: String(error && error.message || 'REDEEM_FAILED').slice(0, 20), icon: 'none' })).finally(() => this.setData({ redeeming: false }))
  }
})
