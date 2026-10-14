import { config } from './config.js'
import { clearSession, readSession } from './session.js'

function sleep(milliseconds) {
  return new Promise(resolve => window.setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)))
}

function isIdempotent(method, explicit) {
  return explicit === true || ['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase())
}

function retryableStatus(status) {
  return [408, 425, 429].includes(status) || status >= 500
}

function uniqueId() {
  return window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

async function mockRequest(options) {
  const module = await import('./mock.js')
  return module.handleMockRequest(options)
}

async function fetchOnce(options) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeout)
  try {
    return await fetch(`${config.apiBaseUrl}${options.url}`, {
      method: options.method,
      headers: options.headers,
      body: ['GET', 'HEAD'].includes(options.method) ? undefined : JSON.stringify(options.data || {}),
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal
    })
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function request(rawOptions) {
  const source = rawOptions && typeof rawOptions === 'object' ? rawOptions : {}
  const method = String(source.method || 'GET').toUpperCase()
  const session = readSession()
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Client-Env': config.environment,
    'X-Request-Id': uniqueId(),
    ...(source.headers || {})
  }
  if (session && !source.skipAuth) headers.Authorization = `Bearer ${session.token}`
  if (source.idempotent && !['GET', 'HEAD'].includes(method)) {
    headers['Idempotency-Key'] = source.idempotencyKey || uniqueId()
  }
  const options = {
    url: String(source.url || ''), method, data: source.data || {}, headers,
    timeout: Math.max(3000, Number(source.timeout) || config.requestTimeout),
    responseType: source.responseType === 'blob' ? 'blob' : 'json'
  }
  const attempts = isIdempotent(method, source.idempotent) ? Math.max(0, Number(source.retry ?? config.retryCount)) : 0

  if (config.enableMock) return mockRequest(options)
  if (!config.apiBaseUrl) throw new Error('生产 API 地址尚未配置')

  let lastError
  for (let index = 0; index <= attempts; index += 1) {
    try {
      const response = await fetchOnce(options)
      if (response.status === 401) {
        clearSession()
        window.dispatchEvent(new CustomEvent('admin:unauthorized'))
        throw new Error('登录已过期，请重新登录')
      }
      if (index < attempts && retryableStatus(response.status)) {
        await sleep(300 * (2 ** index))
        continue
      }
      if (options.responseType === 'blob') {
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          throw new Error(payload?.message || `文件读取失败（${response.status}）`)
        }
        return response.blob()
      }
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.message || `服务请求失败（${response.status}）`)
      if (payload && Object.prototype.hasOwnProperty.call(payload, 'code')) {
        if (![0, 200].includes(Number(payload.code))) throw new Error(payload.message || '业务处理失败')
        return Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload
      }
      if (payload == null) throw new Error('服务返回了空数据')
      return payload
    } catch (error) {
      lastError = error
      if (index >= attempts || /登录已过期/.test(error.message)) break
      await sleep(300 * (2 ** index))
    }
  }
  throw lastError || new Error('服务暂不可用')
}
