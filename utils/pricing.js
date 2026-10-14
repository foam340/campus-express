const { DEFAULT_SETTINGS } = require('../config/business')
const { roundMoney } = require('./format')
const { toFiniteNumber } = require('./value')

function calculatePrice(order, settings) {
  const safeOrder = order || {}
  const safeSettings = settings || {}
  const offCampus = safeOrder.scope === 'off_campus'
  const urgent = safeOrder.urgency === 'urgent'
  const baseKey = urgent
    ? (offCampus ? 'offCampusUrgentPrice' : 'campusUrgentPrice')
    : (offCampus ? 'offCampusPrice' : 'campusPrice')
  const pieces = Math.max(1, Math.floor(toFiniteNumber(safeOrder.pieces, 1)))
  const base = toFiniteNumber(safeSettings[baseKey], DEFAULT_SETTINGS[baseKey])
  const pieceFee = (pieces - 1) * toFiniteNumber(safeSettings.extraPiecePrice, DEFAULT_SETTINGS.extraPiecePrice)
  const largeFee = safeOrder.isLarge ? toFiniteNumber(safeSettings.largePrice, DEFAULT_SETTINGS.largePrice) : 0
  // 9栋固定附加费：9栋一律 +buildingSurcharge，与是否送上门无关。
  const buildingFee = safeOrder.building === '9栋'
    ? toFiniteNumber(safeSettings.buildingSurcharge, DEFAULT_SETTINGS.buildingSurcharge)
    : 0
  // 上门加价统一 +1：9栋与其他楼一致（2026-09-16 起，building9Surcharge 已改为与 toDoorFee 同值）。
  const toDoorFee = safeOrder.toDoor
    ? (safeOrder.building === '9栋'
        ? toFiniteNumber(safeSettings.building9Surcharge, DEFAULT_SETTINGS.building9Surcharge)
        : toFiniteNumber(safeSettings.toDoorFee, DEFAULT_SETTINGS.toDoorFee))
    : 0
  const total = roundMoney(base + pieceFee + largeFee + buildingFee + toDoorFee)
  return { total, base, pieces: pieceFee, large: largeFee, building: buildingFee, toDoor: toDoorFee }
}

module.exports = { calculatePrice }
