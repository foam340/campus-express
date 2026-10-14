function pad(value, length) {
  return String(value == null ? '' : value).padStart(Math.max(1, Number(length) || 2), '0')
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now())
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  return `${pad(safeDate.getMonth()+1)}月${pad(safeDate.getDate())}日 ${pad(safeDate.getHours())}:${pad(safeDate.getMinutes())}`
}

function roundMoney(value) {
  const amount = Number(value)
  return Number(Math.max(0, Number.isFinite(amount) ? amount : 0).toFixed(2))
}

function normalizeText(value, maxLength, fallback) {
  const text = String(value == null ? '' : value).trim()
  const limit = Math.max(0, Math.floor(Number(maxLength) || 0))
  if (!text) return String(fallback || '')
  return limit ? text.slice(0, limit) : text
}

function formatExpiryDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

module.exports = { pad, formatDateTime, roundMoney, formatExpiryDate, normalizeText }
