const config = require('../config/index')

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const threshold = LEVELS[config.logLevel] == null ? LEVELS.info : LEVELS[config.logLevel]

function write(level, message, detail) {
  if (LEVELS[level] < threshold) return
  const method = level === 'debug' ? 'log' : level
  const payload = detail === undefined ? '' : detail
  if (console && typeof console[method] === 'function') console[method](`[${level}] ${message}`, payload)
}

module.exports = {
  warn: (message, detail) => write('warn', message, detail),
  error: (message, detail) => write('error', message, detail)
}
