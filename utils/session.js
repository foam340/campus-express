const KEYS = Object.freeze({
  accessToken: 'campus_access_token',
  accessExpiresAt: 'campus_access_expires_at',
  registrationToken: 'campus_registration_token',
  registrationExpiresAt: 'campus_registration_expires_at'
})

function readString(key) {
  return String(wx.getStorageSync(key) || '').trim()
}

function readExpiry(key) {
  const value = Number(wx.getStorageSync(key) || 0)
  return Number.isFinite(value) ? value : 0
}

function usable(tokenKey, expiryKey) {
  const token = readString(tokenKey)
  const expiresAt = readExpiry(expiryKey)
  return token && expiresAt > Date.now() + 30 * 1000 ? token : ''
}

function getAccessToken() {
  const token = usable(KEYS.accessToken, KEYS.accessExpiresAt)
  if (!token) clearAccessSession()
  return token
}

function setAccessSession(token, expiresAt) {
  const value = String(token || '').trim()
  const expiry = Number(expiresAt) || 0
  if (!value || expiry <= Date.now()) return clearAccessSession()
  wx.setStorageSync(KEYS.accessToken, value)
  wx.setStorageSync(KEYS.accessExpiresAt, expiry)
}

function clearAccessSession() {
  wx.removeStorageSync(KEYS.accessToken)
  wx.removeStorageSync(KEYS.accessExpiresAt)
}

function getRegistrationToken() {
  const token = usable(KEYS.registrationToken, KEYS.registrationExpiresAt)
  if (!token) clearRegistrationSession()
  return token
}

function setRegistrationSession(token, expiresAt) {
  const value = String(token || '').trim()
  const expiry = Number(expiresAt) || 0
  if (!value || expiry <= Date.now()) return clearRegistrationSession()
  wx.setStorageSync(KEYS.registrationToken, value)
  wx.setStorageSync(KEYS.registrationExpiresAt, expiry)
}

function clearRegistrationSession() {
  wx.removeStorageSync(KEYS.registrationToken)
  wx.removeStorageSync(KEYS.registrationExpiresAt)
}

module.exports = {
  clearAccessSession,
  clearRegistrationSession,
  getAccessToken,
  getRegistrationToken,
  setAccessSession,
  setRegistrationSession
}
