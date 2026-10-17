const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const orderApi = require('../../../utils/order-api')
const { getRiderAccess } = require('../../../utils/permissions')
const { APP_VERSION, ROUTES } = require('../../../config/constants')
const { getRiderProgress } = require('../../../utils/rider-level')
const theme = require('../../../utils/theme')
const modeStore = require('../../../utils/mode')
const validators = require('../../../utils/validators')

const initialProgress = getRiderProgress(0)
const PROFILE_FRESH_MS = 30 * 1000

createPage({
  data: { appVersion:APP_VERSION, user: {}, riderProgress: initialProgress, mode: 'user', avatar: '用', couponCount: 0, showRules: false, rulesTab: 'terms', reviewMode: true, closeTime: '20:00', themePref: 'system', riderEmail: '', savingEmail: false },
  onShow() {
    const user = store.getUser() || {}
    const mode = modeStore.getMode()
    const settings = store.getSettings()
    this.$setDataChanged({ user, riderProgress:getRiderProgress(user.riderProgress || user), avatar:(user.name || '').charAt(0), mode, reviewMode: settings.reviewMode !== false, closeTime: settings.closeTime || '20:00', themePref: theme.getPreference(), riderEmail: user.riderEmail || '' })
    if (mode !== 'rider' && (!this.couponsRefreshedAt || Date.now() - this.couponsRefreshedAt >= PROFILE_FRESH_MS)) {
      if (!this.couponRefreshTask) {
        this.couponRefreshTask = orderApi.listCoupons().then(items => {
          this.couponsRefreshedAt = Date.now()
          this.$setDataChanged({ couponCount: items.filter(item => item.status === 'available').length })
        }).catch(() => {}).finally(() => { this.couponRefreshTask = null })
      }
    }
    if (mode === 'rider' && user.riderApproved) {
      if (this.riderProfileRefreshedAt && Date.now() - this.riderProfileRefreshedAt < PROFILE_FRESH_MS) return
      orderApi.getCurrentUser().then(remoteUser => {
        if (!remoteUser) return
        this.riderProfileRefreshedAt = Date.now()
        store.setUser(Object.assign({}, store.getUser() || {}, remoteUser))
        const refreshedUser = store.getUser() || {}
        this.$setDataChanged({
          user: refreshedUser,
          riderProgress: getRiderProgress(refreshedUser.riderProgress || refreshedUser),
          avatar: (refreshedUser.name || '').charAt(0)
        })
      }).catch(() => {})
    }
  },
  switchRider() {
    if (!getRiderAccess(this.data.user).allowed) { wx.navigateTo({ url:ROUTES.riderApply }); return }
    modeStore.setMode('rider'); wx.switchTab({ url:ROUTES.riderHall })
  },
  switchUser() { modeStore.setMode('user'); wx.switchTab({ url:ROUTES.home }) },
  applyRider() { wx.navigateTo({ url:ROUTES.riderApply }) },
  service() { wx.navigateTo({ url:ROUTES.service }) },
  wallet() { if (!this.data.reviewMode) wx.navigateTo({ url:ROUTES.wallet }) },
  openCoupons() { if (!this.data.reviewMode) wx.navigateTo({ url:ROUTES.coupons }) },
  openFeedback() { wx.navigateTo({ url:ROUTES.feedback }) },
  openRules() { this.setData({ showRules: true, rulesTab: 'terms' }) },
  closeRules() { this.setData({ showRules: false }) },
  switchRulesTab(event) { const tab = event.currentTarget.dataset.tab; if (tab) this.setData({ rulesTab: tab }) },
  noop() {},
  setTheme(event) {
    const value = event.currentTarget.dataset.theme
    if (value !== 'system' && value !== 'light' && value !== 'dark') return
    theme.setPreference(value)
    this.setData({ themePref: value })
  },
  editProfile() { wx.navigateTo({ url:ROUTES.editProfile }) },
  openCampusChange() { wx.navigateTo({ url:ROUTES.campusChange }) },
  inputRiderEmail(e) { this.setData({ riderEmail: String(e.detail.value || '') }) },
  saveRiderEmail() {
    if (this.data.savingEmail) return
    const email = String(this.data.riderEmail || '').trim()
    if (!validators.isEmail(email)) { wx.showToast({ title: '邮箱格式不正确', icon: 'none' }); return }
    // 疑似手滑（如 qq.co）：软提示 + 一键纠正（后端已硬拦，不能强制保存）
    const suspicion = validators.emailSuspicion(email)
    if (suspicion) {
      wx.showModal({
        title: '邮箱域名疑似写错',
        content: suspicion.reason + '，请改为 ' + suspicion.suggest + '。',
        confirmText: '改为 ' + suspicion.suggest,
        cancelText: '返回修改',
        success: res => {
          if (res.confirm) {
            this.setData({ riderEmail: suspicion.suggest })
            this._saveRiderEmail(suspicion.suggest, true)
          }
        }
      })
      return
    }
    this._saveRiderEmail(email, false)
  },
  _saveRiderEmail(email, warned) {
    this.setData({ savingEmail: true })
    orderApi.updateRiderEmail(email).then(result => {
      const savedEmail = (result && result.email) || email || ''
      const warning = result && result.warning
      const user = Object.assign({}, store.getUser() || {}, { riderEmail: savedEmail })
      store.setUser(user)
      this.setData({ riderEmail: savedEmail, user })
      if (warning && !warned) {
        this._warnFromServer(warning)
      } else {
        wx.showToast({ title: savedEmail ? '已保存' : '已清空', icon: 'none' })
      }
    }).catch(error => wx.showToast({ title: String(error && error.message || '保存失败').slice(0, 20), icon: 'none' }))
      .finally(() => this.setData({ savingEmail: false }))
  },
  _warnFromServer(warning) {
    wx.showModal({ title: '邮箱域名疑似写错', content: warning, showCancel: false, confirmText: '我知道了' })
  }
})
