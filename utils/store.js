const state = require('./state')
const preload = require('./preload')
const { DEFAULT_SETTINGS } = require('../config/business')
const { getRiderProgress } = require('./rider-level')
const { SHIPAI_STATIONS } = require('../config/constants')

const REGISTRATION_VERSION = 1
const CACHE_VERSION = 9
let initialized = false
let cachedUser
let cachedOrders
let cachedSettings
// 审核展示是全局状态；不允许某个校区的旧缓存解除审核展示。
let remoteReviewMode
let reviewModeRefreshing = false
let cachedRegistrationComplete
const MIGRATED_SETTING_KEYS = [
  'pricingVersion',
  'openTime',
  'closeTime',
  'cutoffHour',
  'campusPrice',
  'offCampusPrice',
  'campusUrgentPrice',
  'offCampusUrgentPrice',
  'extraPiecePrice',
  'largePrice',
  'toDoorFee',
  'building9Surcharge',
  'buildingSurcharge',
  'adminWechat'
]

function sameValue(left, right) {
  if (left === right) return true
  try { return JSON.stringify(left) === JSON.stringify(right) } catch (_) { return false }
}

function settingsStorageKey(campus) {
  return 'campus_settings_' + (String(campus || '').trim() || 'nanhai')
}

function currentCampus() {
  const user = getUser()
  return user && user.campus ? String(user.campus) : 'nanhai'
}

// 老版本设置缓存是单槽 campus_settings；迁移到按校区分槽 campus_settings_<campus>（历史默认南海）。
function migrateCachedSettings() {
  const legacy = wx.getStorageSync('campus_settings')
  if (legacy && typeof legacy === 'object') {
    const next = Object.assign({}, legacy)
    if (!(Number(legacy.pricingVersion) >= DEFAULT_SETTINGS.pricingVersion)) {
      MIGRATED_SETTING_KEYS.forEach(key => { next[key] = DEFAULT_SETTINGS[key] })
    }
    wx.setStorageSync('campus_settings_nanhai', next)
    try { wx.removeStorageSync('campus_settings') } catch (error) {}
  }
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object') return null
  const progress = getRiderProgress(user.riderProgress || user)
  return Object.assign(
    { name: '', phone: '', building: '1栋', room: '', campus: 'nanhai', address: '', riderEmail: '', riderApproved: false, riderStatus: 'none', validOvertimes: 0 },
    user,
    {
      experiencePoints: progress.experiencePoints,
      riderLevel: progress.level,
      riderLevelName: progress.levelName,
      maxActiveOrders: progress.maxActiveOrders,
      riderProgress: progress
    }
  )
}

function normalizeOrder(order) {
  const source = order && typeof order === 'object' ? order : {}
  return Object.assign({
    id: '', status: 'waiting', statusText: '', urgency: 'today', urgencyText: '', pickupScope: '', pickupScopeText: '', deadline: '', pieces: 1,
    isLarge: false, noUpstairs: false, building: '', room: '', campus: 'nanhai', address: '', pickupStation: '', pickupStationText: '', phone: '', contactName: '', price: 0, originalPrice: 0,
    discountAmount: 0, paidAmount: 0, note: '', screenshots: [], deliveryImages: [], accepted: false,
    observationHours: 24, observationEndsAt: 0, refundStatus: '', refundStatusText: '', refundAmount: 0,
    pricingModel: 'legacy', pricingVersion: 1, items: [], pickupScopes: [], itemSubtotal: 0, bundleDiscount: 0, urgencyFee: 0, doorFee: 0, buildingFee: 0
  }, source, {
    pieces: Math.max(1, Number(source.pieces) || 1),
    price: Math.max(0, Number(source.price) || 0),
    originalPrice: Math.max(0, Number(source.originalPrice) || 0),
    discountAmount: Math.max(0, Number(source.discountAmount) || 0),
    paidAmount: Math.max(0, Number(source.paidAmount) || 0),
    observationHours: Math.max(1, Number(source.observationHours) || 24),
    observationEndsAt: Math.max(0, Number(source.observationEndsAt) || 0),
    refundAmount: Math.max(0, Number(source.refundAmount) || 0),
    pricingVersion: Math.max(1, Math.floor(Number(source.pricingVersion) || 1)),
    itemSubtotal: Math.max(0, Number(source.itemSubtotal) || 0),
    bundleDiscount: Math.max(0, Number(source.bundleDiscount) || 0),
    urgencyFee: Math.max(0, Number(source.urgencyFee) || 0),
    doorFee: Math.max(0, Number(source.doorFee) || 0),
    buildingFee: Math.max(0, Number(source.buildingFee) || 0),
    items: Array.isArray(source.items) ? source.items : [],
    pickupScopes: Array.isArray(source.pickupScopes) ? source.pickupScopes : [],
    pickupStationText: (SHIPAI_STATIONS.find(item => item.value === source.pickupStation) || {}).label || '',
    screenshots: Array.isArray(source.screenshots) ? source.screenshots : [],
    deliveryImages: Array.isArray(source.deliveryImages) ? source.deliveryImages : []
  })
}

function ensureDemoData() {
  if (initialized) return
  if (Number(wx.getStorageSync('campus_order_cache_version') || 0) !== CACHE_VERSION) {
    wx.setStorageSync('campus_orders', [])
    wx.setStorageSync('campus_order_cache_version', CACHE_VERSION)
  }
  migrateCachedSettings()
  initialized = true
}

function getUser() {
  ensureDemoData()
  if (typeof cachedUser === 'undefined') {
    cachedUser = normalizeUser(wx.getStorageSync('campus_user'))
    state.setState({ user: cachedUser })
  }
  return cachedUser
}

function setUser(user) {
  const normalized = normalizeUser(user)
  const current = typeof cachedUser === 'undefined' ? getUser() : cachedUser
  if (sameValue(current, normalized)) return normalized
  wx.setStorageSync('campus_user', normalized || '')
  cachedUser = normalized
  state.setState({ user: normalized })
  return normalized
}

function isRegistrationComplete() {
  ensureDemoData()
  if (typeof cachedRegistrationComplete === 'undefined') {
    cachedRegistrationComplete = Number(wx.getStorageSync('campus_registration_version') || 0) >= REGISTRATION_VERSION && Boolean(getUser())
  }
  return cachedRegistrationComplete
}

function completeRegistration(user) {
  const previous = getUser()
  const next = Object.assign({}, previous || {}, user || {}, {
    registeredAt: Number(user && user.registeredAt) || Number(previous && previous.registeredAt) || Date.now(),
    profileUpdatedAt: Number(user && user.profileUpdatedAt) || Date.now()
  })
  setUser(next)
  wx.setStorageSync('campus_registration_version', REGISTRATION_VERSION)
  cachedRegistrationComplete = true
  // 不再把 campus_mode 重置为 user：冷启动会走这里（app.js onLaunch 与 welcome 自动登录），
  // 若强行重置会抹掉骑手「上次停在骑手模式」的记忆。首次注册时该键尚未写入，读处 `|| 'user'` 自然兜底。
  return next
}

function getOrders() {
  ensureDemoData()
  if (typeof cachedOrders === 'undefined') {
    const orders = wx.getStorageSync('campus_orders')
    cachedOrders = Array.isArray(orders) ? orders.map(normalizeOrder) : []
  }
  return cachedOrders
}

function saveOrders(orders) {
  const normalized = Array.isArray(orders) ? orders.filter(item => item && item.id).map(normalizeOrder) : []
  const current = typeof cachedOrders === 'undefined' ? getOrders() : cachedOrders
  if (sameValue(current, normalized)) return normalized
  wx.setStorageSync('campus_orders', normalized)
  cachedOrders = normalized
  return normalized
}

function getOrder(id) { return typeof id === 'string' ? getOrders().find(item => item.id === id) || null : null }

function currentReviewMode() { return reviewModeRefreshing || remoteReviewMode !== false }

function publishReviewMode() {
  const reviewMode = currentReviewMode()
  if (cachedSettings && cachedSettings.data.reviewMode !== reviewMode) {
    cachedSettings.data = Object.assign({}, cachedSettings.data, { reviewMode })
  }
  state.setState(Object.assign({ reviewMode, reviewModeChecking: reviewModeRefreshing }, cachedSettings ? { settings: cachedSettings.data } : {}))
}

function beginReviewModeRefresh() {
  reviewModeRefreshing = true
  publishReviewMode()
}

function finishReviewModeRefresh(value) {
  remoteReviewMode = typeof value === 'boolean' ? value : undefined
  reviewModeRefreshing = false
  publishReviewMode()
}

function getSettings(campus) {
  ensureDemoData()
  const keyCampus = String(campus || currentCampus()).trim() || 'nanhai'
  if (typeof cachedSettings === 'undefined' || cachedSettings.campus !== keyCampus) {
    const stored = wx.getStorageSync(settingsStorageKey(keyCampus))
    cachedSettings = { campus: keyCampus, data: Object.assign({}, DEFAULT_SETTINGS, stored && typeof stored === 'object' ? stored : {}, { reviewMode: currentReviewMode() }) }
    state.setState({ settings: cachedSettings.data })
    preload.primeSettings(cachedSettings.data)
  }
  return cachedSettings.data
}

function setSettings(settings, campus) {
  ensureDemoData()
  const keyCampus = String(campus || currentCampus()).trim() || 'nanhai'
  const current = getSettings(keyCampus)
  if (settings && typeof settings.reviewMode === 'boolean') {
    // 只有全局设置核验可以退出已确认的审核模式，避免晚返回的校区响应恢复金额。
    if (settings.reviewMode || remoteReviewMode !== true) remoteReviewMode = settings.reviewMode
  }
  const normalized = Object.assign(
    {},
    DEFAULT_SETTINGS,
    current && typeof current === 'object' ? current : {},
    settings && typeof settings === 'object' ? settings : {},
    { reviewMode: currentReviewMode() }
  )
  if (sameValue(current, normalized)) return current
  wx.setStorageSync(settingsStorageKey(keyCampus), normalized)
  cachedSettings = { campus: keyCampus, data: normalized }
  state.setState({ settings: normalized, reviewMode: normalized.reviewMode })
  preload.primeSettings(normalized)
  return normalized
}

function clearAccountData() {
  try {
    wx.removeStorageSync('campus_user')
    wx.removeStorageSync('campus_orders')
  } catch (error) {}
  cachedUser = null
  cachedOrders = []
  cachedRegistrationComplete = false
  cachedSettings = undefined   // 登出后重置设置缓存：换账号/换校区后按新 campus 重新读，避免串味
  state.setState({ user: null })
}

module.exports = { ensureDemoData, getUser, setUser, isRegistrationComplete, completeRegistration, getOrders, saveOrders, getOrder, getSettings, setSettings, beginReviewModeRefresh, finishReviewModeRefresh, clearAccountData }
