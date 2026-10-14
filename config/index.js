const env = require('./current')
const constants = require('./constants')

function validateEnvironment(config) {
  const safe = Object.assign({}, config)
  ;['apiBaseUrl', 'uploadBaseUrl', 'downloadBaseUrl', 'webBaseUrl'].forEach(key => {
    if (!/^https:\/\//.test(safe[key] || '')) safe[key] = ''
  })
  safe.requestTimeout = Math.max(3000, Number(safe.requestTimeout) || 10000)
  safe.retryCount = Math.max(0, Math.min(3, Number(safe.retryCount) || 0))
  return safe
}

module.exports = Object.assign(validateEnvironment(env), constants)
