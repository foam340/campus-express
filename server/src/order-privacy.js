const DEFAULT_OBSERVATION_HOURS = 24

function timestampMilliseconds(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  return Date.parse(value) || 0
}

function observationHours(value) {
  const hours = Number(value)
  return Number.isFinite(hours) && hours >= 1 && hours <= 168
    ? hours
    : DEFAULT_OBSERVATION_HOURS
}

function observationEndsAt(completedAt, configuredHours) {
  const completedAtMs = timestampMilliseconds(completedAt)
  return completedAtMs
    ? completedAtMs + observationHours(configuredHours) * 60 * 60 * 1000
    : 0
}

function riderPrivateVisible(completedAt, configuredHours, now = Date.now()) {
  const endsAt = observationEndsAt(completedAt, configuredHours)
  return !endsAt || Number(now) < endsAt
}

module.exports = {
  observationEndsAt,
  observationHours,
  riderPrivateVisible,
  timestampMilliseconds
}
