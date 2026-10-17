const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const orderApi = require('../../../utils/order-api')
const { createShareMessage } = require('../../../utils/share')
const { formatExpiryDate } = require('../../../utils/format')
const { ROUTES } = require('../../../config/constants')
const modeStore = require('../../../utils/mode')

const HOME_FRESH_MS = 5 * 1000

function getLastCouponSeenAt() {
  try { return Number(wx.getStorageSync('campus_last_coupon_seen')) || 0 } catch (_) { return 0 }
}

function setLastCouponSeenAt(value) {
  wx.setStorageSync('campus_last_coupon_seen', value)
}

createPage({
  data: {
    user: {}, activeOrder: null, settings: {}, serviceClosed: false, serviceNotice: '',
    reviewMode: store.getSettings().reviewMode !== false,
    showCouponGift: false, couponGifts: [],
    homeLoading: false
  },
  onShow() {
    modeStore.setMode('user')
    const app = getApp()
    const authentication = app && app.authReady ? app.authReady : Promise.resolve(null)
    Promise.resolve(authentication).catch(() => null).then(() => this.refreshHome())
  },
  refreshHome() {
    if (!store.isRegistrationComplete()) { wx.reLaunch({ url:ROUTES.welcome }); return }
    const user = store.getUser()
    if (!user) { wx.reLaunch({ url:ROUTES.welcome }); return }
    const settings = store.getSettings()
    const cached = store.getOrders()
    this.$setDataChanged({
      user,
      activeOrder: cached.find(item => !['completed','cancelled'].includes(item.status)) || null,
      settings,
      reviewMode: settings.reviewMode !== false,
      serviceClosed: settings.serviceStatus === 'closed',
      serviceNotice: settings.serviceNotice || ''
    })
    if (this.homeRefreshedAt && Date.now() - this.homeRefreshedAt < HOME_FRESH_MS) return Promise.resolve()
    if (this.homeRefreshTask) return this.homeRefreshTask
    if (!cached.some(item => !['completed','cancelled'].includes(item.status))) this.setData({ homeLoading: true })
    this.homeRefreshTask = orderApi.getHomeOverview().then(overview => {
      const orders = overview.orders
      const nextSettings = store.setSettings(overview.settings)
      store.saveOrders(orders)
      const activeOrder = orders.find(item => !['completed','cancelled'].includes(item.status)) || null
      this.$setDataChanged({
        activeOrder,
        settings: nextSettings,
        reviewMode: nextSettings.reviewMode !== false,
        serviceClosed: nextSettings.serviceStatus === 'closed',
        serviceNotice: nextSettings.serviceNotice || ''
      })
      this.homeRefreshedAt = Date.now()
      return this.checkCouponGifts(overview.coupons)
    }).catch(() => {}).finally(() => { this.homeRefreshTask = null; this.setData({ homeLoading: false }) })
    return this.homeRefreshTask
  },
  checkCouponGifts(coupons) {
    if (this.data.reviewMode) return Promise.resolve()
    const source = Array.isArray(coupons) ? Promise.resolve(coupons) : orderApi.listCoupons()
    return source.then(items => {
      if (this.data.reviewMode) return
      const lastSeen = getLastCouponSeenAt()
      const fresh = items.filter(item => {
        return item.status === 'available' && item.campaignId && item.createdAtMs > lastSeen
      })
      if (fresh.length) {
        const maxCreated = Math.max(...fresh.map(item => item.createdAtMs))
        setLastCouponSeenAt(maxCreated)
        const couponGifts = fresh.slice(0, 5).map(item => Object.assign({}, item, {
          expireText: item.expiresAtMs ? '有效期至 ' + formatExpiryDate(item.expiresAtMs) : ''
        }))
        this.setData({ showCouponGift: true, couponGifts })
      }
    }).catch(() => {})
  },
  onReviewModeChanged(reviewMode) {
    if (!reviewMode && store.isRegistrationComplete()) this.checkCouponGifts()
  },
  dismissCouponGift() {
    this.setData({ showCouponGift: false, couponGifts: [] })
  },
  noop() {},
  goCreate() {
    if (this.data.serviceClosed) {
      wx.showModal({ title: '暂停服务', content: this.data.serviceNotice || '节假日小程序暂停服务，恢复时间另行通知', showCancel: false })
      return
    }
    // 下单页已按校区配置合一（校内/校外开关、驿站、自由地址、审核模式均由下单页按 campus 渲染）。
    wx.navigateTo({ url: ROUTES.createOrder })
  },
  goOrder() { if (this.data.activeOrder) wx.navigateTo({ url:`${ROUTES.orderDetail}?id=${encodeURIComponent(this.data.activeOrder.id)}&role=user` }) },
  goOrders() { wx.switchTab({ url:ROUTES.orders }) },
  goProfile() { wx.switchTab({ url:ROUTES.profile }) },
  onShareAppMessage() { return createShareMessage({ title:'校园快递代拿，送到宿舍门口', imageUrl:'/assets/share-cover.jpg' }) },
  onShareTimeline() { return { title:'校园快递代拿，送到宿舍门口', imageUrl:'/assets/share-cover.jpg' } }
})
