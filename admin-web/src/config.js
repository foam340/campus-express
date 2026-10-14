const rawConfig = window.__ADMIN_CONFIG__ && typeof window.__ADMIN_CONFIG__ === 'object'
  ? window.__ADMIN_CONFIG__
  : {}

function httpsUrl(value) {
  const text = String(value || '').replace(/\/$/, '')
  return /^https:\/\//.test(text) ? text : ''
}

export const config = Object.freeze({
  environment: ['development', 'test', 'production'].includes(rawConfig.environment)
    ? rawConfig.environment
    : 'development',
  apiBaseUrl: httpsUrl(rawConfig.apiBaseUrl),
  enableMock: rawConfig.enableMock === true,
  requestTimeout: Math.max(3000, Number(rawConfig.requestTimeout) || 10000),
  retryCount: Math.max(0, Math.min(3, Number(rawConfig.retryCount) || 0)),
  version: String(rawConfig.version || '5.0.0')
})

export function environmentLabel() {
  return { development: '开发环境', test: '测试环境', production: '生产环境' }[config.environment]
}
