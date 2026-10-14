function deepClone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    return fallback
  }
}

function toFiniteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : (Number.isFinite(fallback) ? fallback : 0)
}

module.exports = { deepClone, toFiniteNumber }
