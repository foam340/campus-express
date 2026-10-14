const logger = require('./logger')

let lastToastAt = 0

function normalizeError(error, context) {
  if (error instanceof Error) return { message: error.message, stack: error.stack || '', context: context || '' }
  if (typeof error === 'string') return { message: error, stack: '', context: context || '' }
  return { message: (error && error.errMsg) || '未知异常', stack: '', context: context || '', raw: error }
}

function reportError(error, context, options) {
  const normalized = normalizeError(error, context)
  logger.error(normalized.message, normalized)
  const settings = options || {}
  if (settings.silent) return normalized
  const now = Date.now()
  if (now - lastToastAt > 2500 && typeof wx !== 'undefined' && wx.showToast) {
    lastToastAt = now
    wx.showToast({ title: settings.userMessage || '操作未完成，请稍后重试', icon: 'none', duration: 2200 })
  }
  return normalized
}

module.exports = { normalizeError, reportError }
