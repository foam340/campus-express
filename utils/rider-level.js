const RIDER_LEVELS = Object.freeze([
  Object.freeze({ level: 1, name: '新手骑手', minExperience: 0, maxActiveOrders: 3 }),
  Object.freeze({ level: 2, name: '熟练骑手', minExperience: 100, maxActiveOrders: 4 }),
  Object.freeze({ level: 3, name: '进阶骑手', minExperience: 300, maxActiveOrders: 5 }),
  Object.freeze({ level: 4, name: '资深骑手', minExperience: 600, maxActiveOrders: 6 }),
  Object.freeze({ level: 5, name: '金牌骑手', minExperience: 1000, maxActiveOrders: 7 })
])

function normalizeCount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0
}

function getRiderProgress(source) {
  const input = source && typeof source === 'object' ? source : { experiencePoints: source }
  const experiencePoints = normalizeCount(
    Object.prototype.hasOwnProperty.call(input, 'experiencePoints') ? input.experiencePoints : input.experience
  )
  let current = RIDER_LEVELS[0]
  for (const candidate of RIDER_LEVELS) {
    if (experiencePoints >= candidate.minExperience) current = candidate
  }
  const next = RIDER_LEVELS.find(candidate => candidate.level === current.level + 1) || null
  const levelSpan = next ? next.minExperience - current.minExperience : 0
  const levelExperience = experiencePoints - current.minExperience
  const progressPercent = next ? Math.min(100, Math.floor(levelExperience / levelSpan * 100)) : 100
  const remoteLimit = normalizeCount(input.maxActiveOrders)
  return {
    experiencePoints,
    level: current.level,
    levelName: current.name,
    currentLevelExperience: current.minExperience,
    nextLevelExperience: next ? next.minExperience : 0,
    experienceToNext: next ? Math.max(0, next.minExperience - experiencePoints) : 0,
    progressPercent,
    activeCount: normalizeCount(input.activeCount),
    maxActiveOrders: remoteLimit || current.maxActiveOrders,
    isMaxLevel: !next
  }
}

module.exports = { RIDER_LEVELS, getRiderProgress }
