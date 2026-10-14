const ITEM_SCOPES = Object.freeze(['campus', 'campus_7', 'off_campus'])
const ITEM_SIZES = Object.freeze(['small', 'medium', 'large'])
const ITEMIZED_PRICING_CURRENT_VERSION = 2

function moneyToCents(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('INVALID_ITEM_PRICE_SETTING')
  return Math.round((numeric + Number.EPSILON) * 100)
}

function centsToMoney(value) {
  return Number((Math.max(0, Number(value) || 0) / 100).toFixed(2))
}

function settingCents(settings, key) {
  if (!settings || !Object.prototype.hasOwnProperty.call(settings, key)) throw new Error(`MISSING_ITEM_PRICE_SETTING:${key}`)
  return moneyToCents(settings[key])
}

function optionalSettingCents(settings, key, fallbackKey) {
  if (settings && Object.prototype.hasOwnProperty.call(settings, key)) return moneyToCents(settings[key])
  return fallbackKey ? settingCents(settings, fallbackKey) : 0
}

function itemPriceKey(item) {
  // campus_7（校内 7栋后门多多买菜寄存点）与校内同价，映射到 campus 价
  const scope = item.scope === 'campus_7' ? 'campus' : item.scope
  return `item_${item.size}_${scope}_price`
}

function normalizedBuilding(value) {
  return String(value || '').trim().replace(/(?:号楼|栋)$/u, '')
}

function roomFloor(value) {
  const match = String(value || '').trim().match(/^([1-9])/)
  return match ? Number(match[1]) : 0
}

function bundleTiers(settings) {
  return [2, 1, 0].map(index => {
    const thresholdKey = `bundle_tier${index}_threshold`
    const discountKey = `bundle_tier${index}_discount`
    if (!Object.prototype.hasOwnProperty.call(settings || {}, thresholdKey) || !Object.prototype.hasOwnProperty.call(settings || {}, discountKey)) return null
    return { threshold: settingCents(settings, thresholdKey), discount: settingCents(settings, discountKey) }
  }).filter(Boolean).sort((left, right) => right.threshold - left.threshold)
}

function calculateItemizedPrice(items, urgency, noUpstairs, settings, address = {}, building9Fee = true) {
  if (!Array.isArray(items) || !items.length) throw new Error('ITEMS_REQUIRED')
  const pricingVersion = Math.max(1, Math.floor(Number(settings && settings.item_pricing_version) || 1))
  const pricedItems = items.map((item, index) => {
    if (!ITEM_SCOPES.includes(item.scope) || !ITEM_SIZES.includes(item.size)) throw new Error('INVALID_ITEM')
    const unitPriceCents = settingCents(settings, itemPriceKey(item))
    return {
      index: index + 1,
      scope: item.scope,
      size: item.size,
      uploadId: item.uploadId,
      unitPrice: centsToMoney(unitPriceCents)
    }
  })
  const itemSubtotalCents = pricedItems.reduce((sum, item) => sum + moneyToCents(item.unitPrice), 0)
  const selectedTier = bundleTiers(settings).find(item => itemSubtotalCents >= item.threshold)
  const bundleDiscountCents = Math.min(selectedTier ? selectedTier.discount : 0, itemSubtotalCents)
  const urgencyFeeCents = urgency === 'urgent' ? settingCents(settings, 'item_urgent_fee') : 0
  const building9 = building9Fee !== false && normalizedBuilding(address.building) === '9'
  const buildingFeeCents = building9 ? optionalSettingCents(settings, 'item_building_9_fee') : 0
  let doorFeeCents = 0
  if (!noUpstairs) {
    const baseDoorFeeCents = settingCents(settings, 'item_door_fee')
    doorFeeCents = !building9 && roomFloor(address.room) >= 4
      ? optionalSettingCents(settings, 'item_upper_floor_door_fee', 'item_door_fee')
      : baseDoorFeeCents
  }
  const totalCents = Math.max(0, itemSubtotalCents - bundleDiscountCents + urgencyFeeCents + doorFeeCents + buildingFeeCents)
  return {
    pricingVersion,
    items: pricedItems,
    itemSubtotal: centsToMoney(itemSubtotalCents),
    bundleDiscount: centsToMoney(bundleDiscountCents),
    urgencyFee: centsToMoney(urgencyFeeCents),
    doorFee: centsToMoney(doorFeeCents),
    buildingFee: centsToMoney(buildingFeeCents),
    total: centsToMoney(totalCents),
    commissionRate: Number(settings.commission_rate) || 0,
    closeTime: settings.close_time
  }
}

module.exports = {
  ITEM_SCOPES,
  ITEM_SIZES,
  ITEMIZED_PRICING_CURRENT_VERSION,
  calculateItemizedPrice
}
