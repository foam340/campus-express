const config = require('../config/index')
const network = require('./network')
const storage = require('./storage')
const session = require('./session')
const { reportError } = require('./errors')

const requestInterceptors = []
const responseInterceptors = []
const inflightReads = new Map()
let loadingCount = 0

function showLoading(title) {
  loadingCount += 1
  if (loadingCount === 1) wx.showLoading({ title: title || '加载中', mask: true })
}

function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1)
  if (loadingCount === 0) wx.hideLoading()
}

function applyInterceptors(value, interceptors) {
  return interceptors.reduce((promise, interceptor) => promise.then(interceptor), Promise.resolve(value))
}

function buildUrl(url) {
  if (/^https:\/\//.test(url || '')) return url
  if (!url || !config.apiBaseUrl) throw new Error('接口地址未配置')
  return `${config.apiBaseUrl.replace(/\/$/, '')}/${String(url).replace(/^\//, '')}`
}

function wxRequest(options) {
  return new Promise((resolve, reject) => {
    wx.request(Object.assign({}, options, { success: resolve, fail: reject }))
  })
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function isIdempotent(options) {
  const method = String(options.method || 'GET').toUpperCase()
  return options.idempotent === true || method === 'GET' || method === 'HEAD'
}

function isRetryableStatus(statusCode) {
  const code = Number(statusCode) || 0
  return code === 408 || code === 425 || code === 429 || code >= 500
}

function executeWithRetry(options, attempts, index) {
  return wxRequest({
    url: buildUrl(options.url),
    method: String(options.method || 'GET').toUpperCase(),
    data: options.data && typeof options.data === 'object' ? options.data : {},
    header: Object.assign({ 'content-type': 'application/json' }, options.header || {}),
    timeout: Math.max(3000, Number(options.timeout) || config.requestTimeout)
  }).then(response => {
    if (index < attempts && isRetryableStatus(response && response.statusCode)) {
      return delay(300 * Math.pow(2, index)).then(() => executeWithRetry(options, attempts, index + 1))
    }
    return response
  }).catch(error => {
    if (index < attempts) {
      return delay(300 * Math.pow(2, index)).then(() => executeWithRetry(options, attempts, index + 1))
    }
    throw error
  })
}

function readRequestKey(options) {
  const method = String(options.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD'].includes(method) || options.dedupe === false) return ''
  const headers = options.header || {}
  return [
    method,
    buildUrl(options.url),
    JSON.stringify(options.data && typeof options.data === 'object' ? options.data : {}),
    String(headers.Authorization || '')
  ].join('|')
}

function executeRequest(options, attempts) {
  const key = readRequestKey(options)
  if (!key) return executeWithRetry(options, attempts, 0)
  if (inflightReads.has(key)) return inflightReads.get(key)
  const task = executeWithRetry(options, attempts, 0).finally(() => inflightReads.delete(key))
  inflightReads.set(key, task)
  return task
}

function validatePayload(data, options) {
  if (typeof options.validate !== 'function') return data
  const result = options.validate(data)
  if (result === false) throw new Error('INVALID_RESPONSE_DATA')
  return result === true || typeof result === 'undefined' ? data : result
}

function createHttpError(response) {
  const statusCode = Number(response && response.statusCode) || 0
  const payload = response && response.data && typeof response.data === 'object' ? response.data : {}
  const error = new Error(payload.message || payload.msg || `服务请求失败（${statusCode || '未知'}）`)
  error.code = payload.code || `HTTP_${statusCode || 'EMPTY'}`
  error.statusCode = statusCode
  error.requestId = payload.requestId || ''
  return error
}

function waitForAuthentication(options, appOverride) {
  const source = options && typeof options === 'object' ? options : {}
  if (source.skipAuth) return Promise.resolve(source)
  let app = appOverride
  if (arguments.length < 2) {
    try { app = typeof getApp === 'function' ? getApp() : null } catch (_) { app = null }
  }
  const authentication = app && app.authReady
  if (!authentication || typeof authentication.then !== 'function') return Promise.resolve(source)
  return Promise.resolve(authentication).catch(() => null).then(() => source)
}

function request(rawOptions) {
  const source = rawOptions && typeof rawOptions === 'object' ? rawOptions : {}
  const cacheKey = source.cacheKey
  if (!network.isOnline()) {
    const cached = cacheKey ? storage.get(cacheKey, { allowExpired: true }) : null
    if (cached != null) {
      wx.showToast({ title: '当前离线，已展示缓存数据', icon: 'none' })
      return Promise.resolve(cached)
    }
    reportError(new Error('network offline'), 'request', { userMessage: '网络不可用，请检查连接' })
    return Promise.reject(new Error('NETWORK_OFFLINE'))
  }

  const initial = Object.assign({ method: 'GET', timeout: config.requestTimeout, retry: config.retryCount, showLoading: true }, source)
  if (initial.showLoading) showLoading(initial.loadingText)

  return waitForAuthentication(initial).then(options => applyInterceptors(options, requestInterceptors)).then(options => {
    const attempts = isIdempotent(options) ? Math.max(0, Number(options.retry) || 0) : 0
    return executeRequest(options, attempts).then(response => ({ response, options }))
  }).then(({ response, options }) => {
    if (!response || response.statusCode < 200 || response.statusCode >= 300) throw createHttpError(response)
    return applyInterceptors(response.data, responseInterceptors).then(data => validatePayload(data, options))
  }).then(data => {
    if (cacheKey) storage.set(cacheKey, data, { level: source.cacheLevel || 'list', ttl: source.cacheTtl })
    return data
  }).catch(error => {
    if (Number(error && error.statusCode) === 401 && !source.skipAuth) {
      session.clearAccessSession()
      try { require('./store').clearAccountData() } catch (_) {}
      wx.reLaunch({ url: '/pages/auth/welcome/welcome' })
    }
    const cached = cacheKey ? storage.get(cacheKey, { allowExpired: true }) : null
    if (cached != null) {
      wx.showToast({ title: '服务暂不可用，已展示缓存', icon: 'none' })
      return cached
    }
    reportError(error, `request:${source.url || ''}`, { userMessage: source.errorMessage || '服务开小差了，请稍后重试' })
    throw error
  }).finally(() => {
    if (initial.showLoading) hideLoading()
  })
}

function addInterceptor(collection, interceptor) {
  if (typeof interceptor !== 'function') return () => {}
  collection.push(interceptor)
  return () => {
    const index = collection.indexOf(interceptor)
    if (index > -1) collection.splice(index, 1)
  }
}

function useRequest(interceptor) { return addInterceptor(requestInterceptors, interceptor) }
function useResponse(interceptor) { return addInterceptor(responseInterceptors, interceptor) }

useRequest(options => Object.assign({}, options, {
  header: Object.assign({}, options.header || {}, {
    'X-Client-Env': config.name,
    'X-Request-Id': `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ...(!options.skipAuth && session.getAccessToken()
      ? { Authorization: `Bearer ${session.getAccessToken()}` }
      : {}),
    ...(options.idempotent === true && !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())
      ? { 'Idempotency-Key': options.idempotencyKey || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}` }
      : {})
  })
}))

useResponse(payload => {
  if (payload == null) throw new Error('EMPTY_RESPONSE')
  if (typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'code')) {
    if (![0, 200].includes(Number(payload.code))) {
      const error = new Error(payload.message || payload.msg || '服务请求失败')
      error.code = payload.code || 'BUSINESS_ERROR'
      throw error
    }
    return Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload
  }
  return payload
})

module.exports = { request, useRequest, useResponse, waitForAuthentication }
