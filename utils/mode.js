const MODE_KEY = 'campus_mode'
let cachedMode = ''

function normalize(value) {
  return value === 'rider' ? 'rider' : 'user'
}

function appState() {
  try {
    const app = getApp()
    if (!app) return null
    if (!app.globalData) app.globalData = {}
    return app.globalData
  } catch (_) {
    return null
  }
}

function getMode() {
  const state = appState()
  if (state && (state.campusMode === 'user' || state.campusMode === 'rider')) return state.campusMode
  if (!cachedMode) {
    try { cachedMode = normalize(wx.getStorageSync(MODE_KEY)) } catch (_) { cachedMode = 'user' }
  }
  if (state) state.campusMode = cachedMode
  return cachedMode
}

function setMode(value) {
  const next = normalize(value)
  const state = appState()
  const previous = state && (state.campusMode === 'user' || state.campusMode === 'rider') ? state.campusMode : cachedMode
  cachedMode = next
  if (state) state.campusMode = next
  if (previous === next) return next
  try {
    if (typeof wx.setStorage === 'function') wx.setStorage({ key: MODE_KEY, data: next })
    else wx.setStorageSync(MODE_KEY, next)
  } catch (_) {}
  return next
}

module.exports = { getMode, setMode }
