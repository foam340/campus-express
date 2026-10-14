class HttpError extends Error {
  constructor(status, message, code = status) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next)
}

function ok(response, data, status = 200) {
  return response.status(status).json({ code: 0, data })
}

function text(value, maxLength = 255) {
  return String(value == null ? '' : value).trim().slice(0, maxLength)
}

function number(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

module.exports = { HttpError, asyncRoute, ok, text, number }
