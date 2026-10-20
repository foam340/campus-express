const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const root = path.resolve(__dirname, '..')
function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module, exports: module.exports, console, setTimeout, clearTimeout,
    require(name) {
      return Object.prototype.hasOwnProperty.call(dependencies, name)
        ? dependencies[name] : require(path.resolve(root, path.dirname(file), name))
    }, ...globals
  }, { filename: file })
  return module.exports
}
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function harness() {
  const storage = new Map()
  for (const campus of ['nanhai', 'shipai', 'gqg']) {
    storage.set('campus_settings_' + campus, { reviewMode: false, campusPrice: campus === 'shipai' ? 3 : 1 })
  }
  const wx = {
    getStorageSync: key => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key)
  }
  const state = load('utils/state.js', { '../config/index': {}, './logger': { warn(error) { throw error } } })
  const store = load('utils/store.js', { './state': state, './preload': { primeSettings() {} } }, { wx })
  return { store, state, wx }
}
function page(file, dependencies, wx = {}, globals = {}) {
  let definition
  load(file, {
    '../../../utils/page': source => { definition = source },
    '../../../utils/content-security': {}, '../../../utils/private-file': {}, ...dependencies
  }, { wx, ...globals })
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) }
  })
}

async function testGlobalSettings() {
  const { store } = harness()
  const campuses = ['nanhai', 'shipai', 'gqg']
  for (const campus of campuses) assert.equal(store.getSettings(campus).reviewMode, true, 'Cold-start cached false must not expose money')
  store.beginReviewModeRefresh()
  store.setSettings({ reviewMode: false }, 'shipai')
  assert.equal(store.getSettings('shipai').reviewMode, true, 'Campus response cannot clear verification guard')
  store.finishReviewModeRefresh(true)
  for (const campus of campuses) {
    store.setUser({ name: '测试', campus })
    assert.equal(store.getSettings().reviewMode, true)
    store.setSettings({ reviewMode: false }, campus)
    assert.equal(store.getSettings().reviewMode, true, 'Late normal response cannot override confirmed global review')
  }
  store.beginReviewModeRefresh()
  store.finishReviewModeRefresh(false)
  for (const campus of campuses) assert.equal(store.getSettings(campus).reviewMode, false, 'Normal mode restores all campuses')
  assert.equal(store.getSettings('shipai').campusPrice, 3, 'Global display mode must preserve campus pricing')
  store.beginReviewModeRefresh()
  for (const campus of campuses) assert.equal(store.getSettings(campus).reviewMode, false, 'Warm refresh must preserve confirmed normal mode')
  store.finishReviewModeRefresh()
  assert.equal(store.getSettings().reviewMode, false, 'A failed refresh must not change the last confirmed mode')
  const cold = harness().store
  cold.beginReviewModeRefresh()
  cold.finishReviewModeRefresh()
  for (const campus of campuses) assert.equal(cold.getSettings(campus).reviewMode, true, 'Cold failure must keep financial content hidden')
}

async function testPageLifecycle() {
  const { store, state } = harness()
  let definition
  let request
  const app = { refreshSettings() { return request ? request.promise : Promise.resolve() } }
  const createPage = load('utils/page.js', {
    './store': store, './state': state,
    './errors': { reportError(error) { throw error } },
    './theme': { getPageMetaStyle: () => '', getPageBackgroundColor: () => '#fff', applyChrome() {} }
  }, { Page: value => { definition = value }, getApp: () => app })
  createPage({ data: { reviewMode: false, showPayQr: false, showCouponSheet: false, showCouponGift: false } })
  assert.equal(definition.data.reviewMode, true, 'First rendered frame hides financial content')
  const instance = Object.assign({}, definition, {
    data: { ...definition.data }, writes: 0,
    setData(patch) { this.writes++; Object.assign(this.data, patch) }
  })
  instance.onLoad({})
  store.finishReviewModeRefresh(false)
  assert.equal(instance.data.reviewMode, false)
  instance.setData({ showPayQr: true, showCouponSheet: true, showCouponGift: true })
  store.beginReviewModeRefresh()
  assert.equal(instance.data.reviewMode, false, 'Warm refresh must not show review content')
  for (const key of ['showPayQr', 'showCouponSheet', 'showCouponGift']) assert.equal(instance.data[key], true, 'Normal UI state survives verification')
  store.finishReviewModeRefresh(false)
  assert.equal(instance.data.reviewMode, false)
  assert.equal(instance.data.showPayQr, true, 'Normal payment state survives foreground verification')
  store.beginReviewModeRefresh()
  store.finishReviewModeRefresh(true)
  for (const key of ['showPayQr', 'showCouponSheet', 'showCouponGift']) assert.equal(instance.data[key], false, 'Confirmed review closes financial UI')
  instance.onShow()
  assert.equal(instance.data.reviewMode, true)
  request = deferred()
  instance.onShow()
  instance.onUnload()
  const writes = instance.writes
  store.finishReviewModeRefresh(false)
  request.resolve()
  await request.promise
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(instance.writes, writes, 'Unloaded page must not receive settings updates')
}

async function testAppRefresh() {
  const { store, state } = harness()
  store.setUser({ campus: 'shipai' })
  const response = deferred()
  let requestedCampus, calls = 0, app
  load('app.js', {
    './utils/store': store, './utils/state': state, './utils/storage': {}, './utils/network': {},
    './utils/preload': {}, './utils/mini-auth': {}, './utils/theme': {},
    './utils/order-api': { getMiniSettings(campus) { requestedCampus = campus; calls++; return response.promise } },
    './utils/errors': { reportError(error) { throw error } }
  }, { App: definition => { app = definition } })
  const first = app.refreshSettings(true)
  assert.equal(first, app.refreshSettings(true), 'Simultaneous page checks share one request')
  assert.equal(calls, 1)
  assert.equal(requestedCampus, 'shipai')
  store.setUser({ campus: 'gqg' })
  response.resolve({ reviewMode: true, campusPrice: 7 })
  await first
  assert.equal(store.getSettings('shipai').campusPrice, 7, 'Save response under campus that was requested')
  assert.equal(store.getSettings('gqg').campusPrice, 1)
  assert.equal(store.getSettings('gqg').reviewMode, true)
  app.settingsRefreshedAt = 0
  app.settingsRefreshTask = null
  // A rejected request keeps the fail-closed display and permits a later retry.
  const failed = deferred()
  app.refreshSettings = app.refreshSettings.bind(app)
  response.promise = failed.promise
  const pending = app.refreshSettings(true)
  failed.reject(new Error('offline'))
  await assert.rejects(pending, /offline/)
  assert.equal(store.getSettings().reviewMode, true)
  assert.equal(app.settingsRefreshTask, null)
}

async function testNormalNavigationDoesNotFlash() {
  for (const campus of ['nanhai', 'shipai', 'gqg']) {
    const { store, state } = harness()
    store.setUser({ campus })
    store.finishReviewModeRefresh(false)
    let app, definition, nextSettings = deferred()
    load('app.js', {
      './utils/store': store, './utils/state': state, './utils/storage': {}, './utils/network': {},
      './utils/preload': {}, './utils/mini-auth': {}, './utils/theme': {},
      './utils/order-api': { getMiniSettings: () => nextSettings.promise },
      './utils/errors': { reportError(error) { throw error } }
    }, { App: value => { app = value } })
    const createPage = load('utils/page.js', {
      './store': store, './state': state,
      './errors': { reportError(error) { throw error } },
      './theme': { getPageMetaStyle: () => '', getPageBackgroundColor: () => '#fff', applyChrome() {} }
    }, { Page: value => { definition = value }, getApp: () => app })
    createPage({ data: { reviewMode: true, showPayQr: true } })
    const frames = [definition.data.reviewMode]
    const instance = { ...definition, data: { ...definition.data }, setData(patch) {
      Object.assign(this.data, patch)
      if (Object.prototype.hasOwnProperty.call(patch, 'reviewMode')) frames.push(patch.reviewMode)
    } }
    instance.onLoad({}); instance.onShow()
    for (const target of ['nanhai', 'shipai', 'gqg']) assert.equal(store.getSettings(target).reviewMode, false)
    nextSettings.resolve({ reviewMode: false })
    await app.settingsRefreshTask
    assert(frames.every(value => value === false), campus + ': normal navigation must never render review mode')
    nextSettings = deferred()
    instance.onHide(); instance.onShow()
    const failedRefresh = app.settingsRefreshTask
    nextSettings.reject(new Error('offline'))
    await assert.rejects(failedRefresh, /offline/)
    assert(frames.every(value => value === false), 'Network failure must not produce an audit-page flash')
    assert.equal(instance.data.showPayQr, true, 'Payment state must survive normal navigation and refresh failure')
    nextSettings = deferred()
    instance.onShow()
    const switchToReview = app.settingsRefreshTask
    nextSettings.resolve({ reviewMode: true })
    await switchToReview
    assert.equal(instance.data.reviewMode, true, 'A real server mode change still takes effect')
    assert.equal(instance.data.showPayQr, false)
    store.setSettings({ reviewMode: false }, 'shipai')
    assert.equal(instance.data.reviewMode, true, 'Late campus responses must not undo confirmed review mode')
    nextSettings = deferred()
    instance.onShow()
    const reviewFailure = app.settingsRefreshTask
    nextSettings.reject(new Error('offline'))
    await assert.rejects(reviewFailure, /offline/)
    assert.equal(instance.data.reviewMode, true, 'Confirmed review mode remains active on network failure')
    nextSettings = deferred()
    instance.onShow()
    const switchToNormal = app.settingsRefreshTask
    nextSettings.resolve({ reviewMode: false })
    await switchToNormal
    assert.equal(instance.data.reviewMode, false, 'A real server switch back to normal mode must still take effect')
    instance.onUnload()
  }
}

async function testCachedHomeCannotChangeMode() {
  for (const campus of ['nanhai', 'shipai', 'gqg']) for (const confirmed of [false, true]) {
    const { store } = harness()
    store.completeRegistration({ name: '测试', phone: '13800000000', campus, building: '1栋', room: '101' })
    store.finishReviewModeRefresh(confirmed)
    const instance = page('pages/user/home/home.js', {
      '../../../utils/store': store,
      '../../../utils/order-api': {
        getHomeOverview: () => Promise.resolve({ orders: [], coupons: [], settings: { reviewMode: !confirmed, serviceStatus: 'open' } }),
        listCoupons: () => Promise.resolve([])
      }
    }, { getStorageSync: () => 0 })
    instance.$setDataChanged = instance.setData
    await instance.refreshHome()
    assert.equal(store.getSettings().reviewMode, confirmed, 'Cached home must not override the independently confirmed mode')
    assert.equal(instance.data.reviewMode, confirmed)
    for (const target of ['nanhai', 'shipai', 'gqg']) {
      store.setSettings({ reviewMode: !confirmed, campusPrice: 9 }, target)
      assert.equal(store.getSettings(target).reviewMode, confirmed, 'Late page settings must not change mode in either direction')
      assert.equal(store.getSettings(target).campusPrice, 9, 'Business settings must still update')
    }
  }
}

async function testLatePaymentResponse() {
  for (const file of ['packages/order/create/create.js', 'packages/order/detail/detail.js']) {
    let calls = 0, previews = 0
    const response = deferred()
    const instance = page(file, {
      '../../../utils/store': { getSettings: () => ({ reviewMode: true }) },
      '../../../utils/order-api': { getPaymentSign() { calls++; return response.promise } }
    }, { showLoading() {}, hideLoading() {}, previewImage() { previews++ }, showToast() {}, showModal() { throw new Error('Unexpected payment modal') } })
    instance.data.order = { id: 'TEST', status: 'unpaid' }
    instance.data.payQrImage = 'test-qr'
    const start = file.includes('/create/') ? () => instance.requestPaymentSign('TEST') : () => instance.retryPayment()
    await start()
    instance.previewPayQr()
    assert.equal(calls, 0, 'Review mode must not request payment')
    assert.equal(previews, 0)
    instance.data.reviewMode = false
    const payment = start()
    assert.equal(calls, 1)
    instance.data.reviewMode = true
    response.resolve({ qrImageUrl: 'test-qr' })
    await payment
    assert.equal(instance.data.showPayQr, false, 'Late payment result must not reopen financial UI')
  }
}

async function testFinancialActions() {
  let navigations = 0, withdrawals = 0, modals = []
  const wx = { navigateTo() { navigations++ }, showModal(options) { modals.push(options) } }
  const profile = page('pages/user/profile/profile.js', {}, wx)
  profile.wallet(); profile.openCoupons()
  assert.equal(navigations, 0)
  profile.data.reviewMode = false
  profile.wallet(); profile.openCoupons()
  assert.equal(navigations, 2, 'Normal routes remain available')
  const wallet = page('packages/account/wallet/wallet.js', {
    '../../../utils/order-api': { requestWithdrawal() { withdrawals++; return Promise.resolve() } }
  }, wx)
  wallet.data.balance.available = 10
  wallet.withdraw()
  assert.equal(modals.length, 0)
  wallet.data.reviewMode = false
  wallet.withdraw()
  assert.equal(modals.length, 1)
  assert.match(modals[0].content, /10\.00/)
  wallet.data.reviewMode = true
  modals[0].success({ confirm: true })
  assert.equal(withdrawals, 0, 'Mode change before confirmation blocks withdrawal')
  const response = deferred()
  const home = page('pages/user/home/home.js', {
    '../../../utils/store': { getSettings: () => ({ reviewMode: true }) },
    '../../../utils/order-api': { listCoupons: () => response.promise }
  }, { getStorageSync: () => 0, setStorageSync() { throw new Error('Hidden gift must not be marked seen') } })
  home.data.reviewMode = false
  const checking = home.checkCouponGifts()
  home.data.reviewMode = true
  response.resolve([{ id: 'TEST', campaignId: 1, status: 'available', amount: 5, createdAtMs: Date.now() }])
  await checking
  assert.equal(home.data.showCouponGift, false)
}

async function testPaymentDuringVerification() {
  for (const reviewMode of [true, false]) for (const file of ['packages/order/create/create.js', 'packages/order/detail/detail.js']) {
    const verification = deferred(), payment = deferred()
    const instance = page(file, {
      '../../../utils/order-api': { getPaymentSign: () => payment.promise }
    }, { showLoading() {}, hideLoading() {}, showToast() {} }, { getApp: () => ({ settingsRefreshTask: verification.promise }) })
    instance.data.reviewMode = false
    instance.data.order = { id: 'TEST', status: 'unpaid' }
    instance.startPaymentPolling = () => {}
    const result = file.includes('/create/') ? instance.requestPaymentSign('TEST') : instance.retryPayment()
    instance.data.reviewMode = true
    payment.resolve({ qrImageUrl: 'test-qr' })
    await payment.promise
    await Promise.resolve()
    assert.equal(instance.data.showPayQr, false, 'Payment display waits for settings verification')
    instance.data.reviewMode = reviewMode
    verification.resolve()
    await result
    assert.equal(instance.data.showPayQr, !reviewMode, 'Verified normal mode retains payment; review mode suppresses it')
  }
}

async function testUiModeActions() {
  const {store} = harness()
  const navigations = []
  const instance = page('packages/order/create/create.js', {
    '../../../utils/store':store, '../../../utils/order-api':{}
  }, {navigateTo(value){navigations.push(value.url)}})
  instance.setData({reviewMode:true})
  instance.goService()
  assert.equal(navigations.length,0,'The new normal-mode service action must not change review-mode navigation')
  instance.setData({reviewMode:false})
  instance.goService()
  assert.equal(navigations.length,1)
  assert.equal(navigations[0],require('../config/constants').ROUTES.service)
  for(const preference of ['light','dark']) {
    const theme = load('utils/theme.js',{}, {wx:{getStorageSync:()=>preference}})
    const style = theme.getTabBarStyle()
    assert(style.includes('--tab-active-icon-filter:brightness(0) saturate(100%)'))
    assert.equal(style.includes('invert(100%)'),preference==='dark','Selected tab icons must stay visible in manual dark mode')
  }
}

async function main() {
  await testGlobalSettings()
  await testPageLifecycle()
  await testAppRefresh()
  await testNormalNavigationDoesNotFlash()
  await testCachedHomeCannotChangeMode()
  await testLatePaymentResponse()
  await testFinancialActions()
  await testPaymentDuringVerification()
  await testUiModeActions()
  console.log('Review mode checks passed: three-campus cache isolation, stable normal navigation, cold/warm failures, real mode changes, page lifecycle, late payments and financial guards.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
