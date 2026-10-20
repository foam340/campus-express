const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const orderApi = require('../../../utils/order-api')
const { CAMPUSES, CAMPUS_LABELS, getCampusConfig, ROUTES } = require('../../../config/constants')

createPage({
  data: {
    currentCampus: 'nanhai',
    currentCampusLabel: '南海校区',
    targetCampus: 'shipai',
    campuses: CAMPUSES,
    campusLabels: CAMPUS_LABELS,
    reason: '',
    submitting: false
  },
  onLoad() {
    const user = store.getUser() || {}
    const currentCampus = CAMPUSES.includes(user.campus) ? user.campus : CAMPUSES[0]
    this.setData({
      currentCampus,
      currentCampusLabel: getCampusConfig(currentCampus).label,
      targetCampus: CAMPUSES.find(c => c !== currentCampus) || currentCampus
    })
  },
  chooseTarget(event) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!CAMPUSES.includes(value)) return
    if (value === this.data.currentCampus) return
    this.setData({ targetCampus: value })
  },
  inputReason(event) { this.setData({ reason: String(event.detail.value || '') }) },
  noop() {},
  submit() {
    if (this.data.submitting) return
    const payload = { toCampus: this.data.targetCampus }
    if (this.data.reviewMode) {
      const reason = String(this.data.reason || '').trim()
      if (reason.length < 2) { wx.showToast({ title: '请填写变更原因', icon: 'none' }); return }
      payload.reason = reason
    }
    this.setData({ submitting: true })
    return orderApi.submitCampusChange(payload).then(result => {
      this.setData({ submitting: false })
      if (!this.data.reviewMode && result && result.status === 'approved') {
        // 使用返回的服务端资料，避免仍拿旧校区/旧地址下单。兼容暂未返回 user 的服务端。
        const userReady = result.user ? Promise.resolve(result.user) : orderApi.getCurrentUser()
        return userReady.then(user => {
          if (!user || user.campus !== result.toCampus) throw new Error('校区已变更，请重新打开小程序同步资料')
          store.setUser(Object.assign({}, store.getUser() || {}, user))
          store.saveOrders([])
          wx.removeStorageSync('cache_v1:remote_home_overview')
          wx.removeStorageSync('cache_v1:remote_my_orders')
          this.setData({ currentCampus: user.campus, currentCampusLabel: getCampusConfig(user.campus).label })
          wx.showModal({
            title: '校区已变更',
            content: '已转入' + getCampusConfig(user.campus).label + '，请先填写新校区的收货地址。',
            showCancel: false,
            success: () => wx.redirectTo({ url: ROUTES.editProfile })
          })
        })
      }
      wx.showModal({
        title: '申请已提交',
        content: '管理员审核通过后校区才会变更。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }).catch(error => {
      this.setData({ submitting: false })
      wx.showToast({ title: String(error && error.message || '提交失败').slice(0, 20), icon: 'none' })
    })
  }
})
