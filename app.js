const store = require('./utils/store')
const state = require('./utils/state')
const storage = require('./utils/storage')
const network = require('./utils/network')
const preload = require('./utils/preload')
const miniAuth = require('./utils/mini-auth')
const orderApi = require('./utils/order-api')
const { reportError } = require('./utils/errors')
const { ROUTES, DORM_BUILDINGS } = require('./config/constants')
const { REVIEW_REGISTRATION_PROFILE } = require('./config/business')
const theme = require('./utils/theme')

App({
  onLaunch() {
    try {
      theme.init()
      store.ensureDemoData()
      const user = store.getUser()
      const settings = store.getSettings()
      state.setState({ user, settings })
      preload.primeSettings(settings)
      storage.set('dorm_buildings', DORM_BUILDINGS, { level: 'dictionary' })
      storage.clearExpired()
      network.initNetworkMonitoring()
      const localUser = store.isRegistrationComplete() ? user : null
      const settingsReady = this.refreshSettings(true).then(settings => ({ settings, remote: true })).catch(() => ({
        settings: store.getSettings(),
        remote: false
      }))
      this.authReady = miniAuth.bootstrap(localUser, {
        reviewProfile: REVIEW_REGISTRATION_PROFILE,
        ready: settingsReady.then(({ settings: remoteSettings, remote }) => ({
          reviewMode: remote && remoteSettings.reviewMode === true
        }))
      }).then(result => {
        if (result && result.registered && result.user) {
          const synchronizedUser = store.completeRegistration(result.user)
          state.setState({ user: synchronizedUser })
        }
        return result
      }).catch(error => {
        reportError(error, 'app:miniAuthBootstrap', { silent: true })
        return null
      })
    } catch (error) {
      reportError(error, 'app:onLaunch', { userMessage: '初始化失败，请重新打开小程序' })
    }
  },
  onShow() {
    network.initNetworkMonitoring()
    this.refreshSettings(false).catch(() => {})
    if (this.routeGuardTimer) clearTimeout(this.routeGuardTimer)
    const guard = () => {
      try {
        const pages = getCurrentPages()
        const current = pages.length ? pages[pages.length - 1].route : ''
        const welcomeRoute = ROUTES.welcome.replace(/^\//, '')
        const ordersRoute = ROUTES.orders.replace(/^\//, '')
        if (!store.isRegistrationComplete() && current && current !== welcomeRoute && current !== ordersRoute) wx.reLaunch({ url: ROUTES.welcome })
      } catch (error) {
        reportError(error, 'app:routeGuard', { silent: true })
      }
    }
    Promise.resolve(this.authReady).catch(() => null).finally(() => {
      if (this.routeGuardTimer) clearTimeout(this.routeGuardTimer)
      this.routeGuardTimer = setTimeout(guard, 0)
    })
  },
  refreshSettings(force) {
    const now = Date.now()
    if (!force && now - Number(this.settingsRefreshedAt || 0) < 60 * 1000) return Promise.resolve(store.getSettings())
    if (this.settingsRefreshTask) return this.settingsRefreshTask
    this.settingsRefreshTask = orderApi.getMiniSettings().then(settings => {
      this.settingsRefreshedAt = Date.now()
      return store.setSettings(settings)
    }).finally(() => { this.settingsRefreshTask = null })
    return this.settingsRefreshTask
  },
  onHide() {
    if (this.routeGuardTimer) clearTimeout(this.routeGuardTimer)
    this.routeGuardTimer = null
    network.stopNetworkMonitoring()
  },
  onError(error) {
    reportError(error, 'app:onError', { userMessage: '页面出现异常，请稍后重试' })
  },
  onUnhandledRejection(event) {
    reportError(event && event.reason ? event.reason : event, 'app:unhandledRejection')
  },
  onMemoryWarning() {
    storage.clearExpired()
  },
  onPageNotFound() {
    if (store.isRegistrationComplete()) wx.switchTab({ url: ROUTES.home })
    else wx.reLaunch({ url: ROUTES.welcome })
  }
})
