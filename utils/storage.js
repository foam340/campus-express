const { CACHE_TTL } = require('../config/constants')
const logger = require('./logger')
const { deepClone } = require('./value')

const PREFIX = 'cache_v1:'

function normalizeOptions(options) {
  if (typeof options === 'string') return { level: options }
  return options && typeof options === 'object' ? options : {}
}

function set(key, value, options) {
  if (!key || typeof key !== 'string') return false
  const normalized = normalizeOptions(options)
  const level = normalized.level || 'list'
  const ttl = Number.isFinite(normalized.ttl) ? Math.max(0, normalized.ttl) : (CACHE_TTL[level] || CACHE_TTL.list)
  const record = { value: deepClone(value, value), createdAt: Date.now(), expiresAt: ttl ? Date.now() + ttl : 0, level }
  try {
    wx.setStorageSync(`${PREFIX}${key}`, record)
    return true
  } catch (error) {
    logger.warn('cache write failed', { key, error })
    return false
  }
}

function get(key, options) {
  if (!key || typeof key !== 'string') return null
  const normalized = normalizeOptions(options)
  const fallback = Object.prototype.hasOwnProperty.call(normalized, 'defaultValue') ? normalized.defaultValue : null
  try {
    const record = wx.getStorageSync(`${PREFIX}${key}`)
    if (!record || typeof record !== 'object' || !Object.prototype.hasOwnProperty.call(record, 'value')) return fallback
    const expired = record.expiresAt && Date.now() > record.expiresAt
    if (expired && !normalized.allowExpired) {
      wx.removeStorageSync(`${PREFIX}${key}`)
      return fallback
    }
    return deepClone(record.value, fallback)
  } catch (error) {
    logger.warn('cache read failed', { key, error })
    return fallback
  }
}

function clearExpired() {
  try {
    const info = wx.getStorageInfoSync()
    const now = Date.now()
    ;(info.keys || []).filter(key => key.indexOf(PREFIX) === 0).forEach(key => {
      const record = wx.getStorageSync(key)
      if (record && record.expiresAt && now > record.expiresAt) wx.removeStorageSync(key)
    })
  } catch (error) {
    logger.warn('cache cleanup failed', error)
  }
}

module.exports = { set, get, clearExpired }
