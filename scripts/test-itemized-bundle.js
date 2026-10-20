const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { calculateItemizedPrice } = require('../server/src/item-pricing')
const { getCampusConfig } = require('../server/src/campus-config')

const root = path.resolve(__dirname, '..')
const baseSettings = {
  item_pricing_version: 2,
  item_small_campus_price: 1, item_small_off_campus_price: 2,
  item_medium_campus_price: 3, item_medium_off_campus_price: 4,
  item_large_campus_price: 5, item_large_off_campus_price: 6,
  item_urgent_fee: 4, item_door_fee: 1, item_upper_floor_door_fee: 1.5,
  item_building_9_fee: 0.5,
  bundle_tier0_threshold: 5, bundle_tier0_discount: 0.5,
  bundle_tier1_threshold: 10, bundle_tier1_discount: 1,
  bundle_tier2_threshold: 20, bundle_tier2_discount: 3,
  commission_rate: 10, close_time: '23:00:00', observation_hours: 24,
  service_status: 'open', review_mode: 0
}

function settingsFor(campus) {
  // Different campus prices expose accidental fallback to Nanhai defaults.
  return { ...baseSettings, ...(campus === 'shipai' ? {
    item_small_campus_price: 3, item_small_off_campus_price: 3,
    item_medium_campus_price: 5, item_medium_off_campus_price: 5,
    item_large_campus_price: 8, item_large_off_campus_price: 8,
    item_door_fee: 2, item_upper_floor_door_fee: 2
  } : {}), campus }
}

function clientPricing(settings) {
  return {
    version: settings.item_pricing_version,
    ...Object.fromEntries(['small', 'medium', 'large'].map(size => [size, {
      campus: settings[`item_${size}_campus_price`], off_campus: settings[`item_${size}_off_campus_price`]
    }])),
    urgentFee: settings.item_urgent_fee, doorFee: settings.item_door_fee,
    upperFloorDoorFee: settings.item_upper_floor_door_fee, building9Fee: settings.item_building_9_fee,
    bundleTiers: [0, 1, 2].map(index => ({
      threshold: settings[`bundle_tier${index}_threshold`], amount: settings[`bundle_tier${index}_discount`]
    }))
  }
}

function loadPage() {
  let definition
  const module = { exports: {} }
  const store = { saveOrders() {}, getOrders: () => [] }
  let submitted
  vm.runInNewContext(fs.readFileSync(path.join(root, 'packages/order/create/create.js'), 'utf8') + '\nmodule.exports = { normalizePricing }', {
    module, console, wx: {},
    require(name) {
      if (name === '../../../utils/page') return value => { definition = value }
      if (name === '../../../utils/store') return store
      if (name === '../../../utils/content-security') return {}
      if (name === '../../../utils/order-api') return { createOrder(input) { submitted = input; return Promise.resolve({ id: 'new', status: 'waiting' }) } }
      return require(path.resolve(root, 'packages/order/create', name))
    }
  })
  const page = {
    ...definition, data: JSON.parse(JSON.stringify(definition.data)), couponMode: 'auto',
    setData(patch) { Object.assign(this.data, patch) }, measureScrollRange() {}, openOrderDetail() {}
  }
  return { page, normalizePricing: module.exports.normalizePricing, submitted: () => submitted }
}

function discountFor(total) { return total >= 20 ? 3 : total >= 10 ? 1 : total >= 5 ? 0.5 : 0 }

function testParity() {
  const { page, normalizePricing } = loadPage()
  let cases = 0
  for (const campus of ['nanhai', 'shipai', 'gqg']) {
    const settings = settingsFor(campus)
    const cfg = getCampusConfig(campus)
    for (const cachedVersion of [2, 3]) for (const size of ['small', 'medium', 'large']) {
      for (const scope of ['campus', 'off_campus']) for (const count of [1, 2, 4, 8]) {
        for (const urgency of ['today', 'urgent']) for (const toDoor of [false, true]) {
          for (const building of campus === 'shipai' ? ['东2栋'] : ['7', '9']) for (const room of ['321', '421']) {
            const items = Array.from({ length: count }, (_, index) => ({ scope, size, uploadId: String(index).padStart(16, '0'), image: 'local' }))
            const user = { campus, building, room }
            const server = calculateItemizedPrice(items, urgency, !toDoor, { ...settings, item_pricing_version: 3 }, user, cfg.building9Fee)
            const before = Math.round((server.itemSubtotal + server.urgencyFee + server.doorFee + server.buildingFee) * 100) / 100
            assert.equal(server.bundleDiscount, discountFor(before))
            assert.equal(server.total, Number((before - discountFor(before)).toFixed(2)))
            page.refresh(items, {
              pricing: normalizePricing({ ...clientPricing(settings), version: cachedVersion }),
              user, urgency, deliveryMode: toDoor ? 'door' : 'downstairs',
              scopeStations: [{ value: scope, priceScope: scope, title: scope }], coupons: []
            })
            assert.equal(Number(page.data.totalText), server.total, JSON.stringify({ campus, cachedVersion, size, scope, count, urgency, toDoor, building, room }))
            assert.equal(Number(page.data.discountText), server.bundleDiscount)
            if (before < 20) {
              const nextThreshold = before < 5 ? 5 : before < 10 ? 10 : 20
              assert(page.data.nextDiscountText.includes((nextThreshold - before).toFixed(2)), 'Next tier hint must include service fees')
            } else assert.equal(page.data.nextDiscountText, '已享受最高档多件优惠')
            cases++
          }
        }
      }
    }
  }
  return cases
}

function testBoundariesAndCoupons() {
  const { page, normalizePricing } = loadPage()
  const item = { scope: 'campus', size: 'small', uploadId: 'a'.repeat(16), image: 'local' }
  for (const threshold of [5, 10, 20]) for (const delta of [-0.01, 0, 0.01]) {
    for (const feeKind of ['urgent', 'door', 'building', 'all']) {
      const urgent = ['urgent', 'all'].includes(feeKind)
      const door = ['door', 'all'].includes(feeKind)
      const building = ['building', 'all'].includes(feeKind)
      const fees = (urgent ? 4 : 0) + (door ? 1 : 0) + (building ? 0.5 : 0)
      // At the first threshold the combined fees can exceed the target; test other combinations there.
      if (threshold + delta <= fees) continue
      const settings = { ...baseSettings, item_pricing_version: 3, item_small_campus_price: Number((threshold + delta - fees).toFixed(2)) }
      const user = { campus: 'nanhai', building: building ? '9' : '7', room: '321' }
      const result = calculateItemizedPrice([item], urgent ? 'urgent' : 'today', !door, settings, user)
      assert.equal(result.bundleDiscount, discountFor(threshold + delta))
      assert.equal(result.total, Number((threshold + delta - discountFor(threshold + delta)).toFixed(2)))
      page.refresh([item], { pricing: normalizePricing(clientPricing(settings)), user, urgency: urgent ? 'urgent' : 'today', deliveryMode: door ? 'door' : 'downstairs', coupons: [] })
      assert.equal(Number(page.data.totalText), result.total)
    }
  }
  const settings = { ...baseSettings, item_pricing_version: 3 }
  const user = { campus: 'nanhai', building: '7', room: '321' }
  const coupon = { id: 'coupon', amount: 2, status: 'available', expiresAtMs: Date.now() + 60000 }
  for (const [minSpend, expected] of [[5, 4.5], [4.5, 2.5]]) {
    page.refresh([item], { pricing: normalizePricing(clientPricing(settings)), user, urgency: 'urgent', deliveryMode: 'downstairs', coupons: [{ ...coupon, minSpend }] })
    assert.equal(Number(page.data.totalText), expected, 'Coupon eligibility must use the total after bundle discount')
  }
  page.refresh([item], { coupons: [{ ...coupon, amount: 99, minSpend: 0 }] })
  assert.equal(Number(page.data.totalText), 0, 'Coupon cannot make payment negative')
  const largeDiscount = { ...settings, bundle_tier0_discount: 99 }
  assert.equal(calculateItemizedPrice([item], 'urgent', true, largeDiscount, user).total, 0)
  page.refresh([item], { pricing: normalizePricing(clientPricing(largeDiscount)), coupons: [] })
  assert.equal(Number(page.data.totalText), 0, 'Frontend and backend cap bundle discounts at the eligible total')
}

function routeHarness(campus, version, quote, coupon) {
  const settings = settingsFor(campus)
  const rows = []
  const uploads = [{ id: 'a'.repeat(16) }]
  const user = { id: 123, campus, nickname: 'fixture', phone: '13800000000', building: campus === 'shipai' ? '东2栋' : '9', room: '421' }
  const db = { async execute(sql, values) {
    if (sql.includes('WHERE o.id = ?')) return [rows]
    if (sql.includes('FROM platform_settings')) {
      if (sql.includes('commission_rate')) assert.equal(values[0], campus, 'Read authenticated campus pricing')
      return [[settings]]
    }
    if (sql.startsWith('SELECT id FROM order_uploads')) return [uploads]
    if (sql.includes('FROM user_coupons')) return [[coupon]]
    if (sql.startsWith('INSERT INTO orders')) {
      const columns = sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map(value => value.trim())
      rows.push(Object.fromEntries(columns.slice(0, values.length).map((column, index) => [column, values[index]])))
      return [{ affectedRows: 1 }]
    }
    if (/^(UPDATE|INSERT INTO order_attachments)/.test(sql)) return [{ affectedRows: 1 }]
    throw new Error('Unexpected SQL: ' + sql)
  } }
  const routes = new Map()
  const router = {}
  for (const method of ['get', 'post', 'put']) router[method] = (route, ...handlers) => routes.set(method + ':' + route, handlers.at(-1))
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-20T04:00:00Z'])) }
    static now() { return Date.parse('2026-10-20T04:00:00Z') }
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server/src/routes/mini.js'), 'utf8'), {
    module: { exports: {} }, console, Date: FixedDate, Buffer,
    require(name) {
      if (name === 'express') return { Router: () => router }
      if (name === 'express-rate-limit') return () => () => {}
      if (name === 'crypto') return require('crypto')
      if (name === '../db') return { pool: db, transaction: callback => callback(db) }
      if (name === '../idempotency') return { sendIdempotent: (request, response, data) => response.json(data) }
      if (name === '../campus-change') return { lockCampusUser: async () => user }
      if (['../urgent-alert-queue', '../rider-notify'].includes(name)) return { queueUrgentOrderAlert: async () => {}, queueNewOrderRiderEmail: async () => {} }
      if (['../http', '../validation', '../business-rules', '../campus-config', '../item-pricing', '../order-privacy', '../rider-level'].includes(name)) return require(path.resolve(root, 'server/src/routes', name))
      return {}
    }
  })
  const body = {
    items: [{ scope: 'campus', size: 'small', uploadId: uploads[0].id }],
    urgency: 'urgent', noUpstairs: false, pricingVersion: version, quotedTotal: quote,
    building: user.building, room: user.room, pickupStation: getCampusConfig(campus).stations?.[0]?.value,
    couponId: coupon ? coupon.id : ''
  }
  function invoke(route, request) {
    return new Promise((resolve, reject) => routes.get(route)(request, { json: resolve, status() { return this } }, reject))
  }
  return {
    settings, rows, user, body,
    order: () => invoke('post:/orders', { body, miniUser: user }),
    readSettings: () => invoke('get:/settings', { query: { campus } })
  }
}

async function testRoutes() {
  for (const campus of ['nanhai', 'shipai', 'gqg']) for (const version of [2, 3]) {
    const fixture = routeHarness(campus, version, 0)
    const settingsSnapshot = JSON.stringify(fixture.settings)
    const expected = calculateItemizedPrice(fixture.body.items, 'urgent', false, { ...fixture.settings, item_pricing_version: version }, fixture.user, getCampusConfig(campus).building9Fee)
    fixture.body.quotedTotal = expected.total
    const response = await fixture.readSettings()
    assert.equal(response.data.itemPricing.version, 3, 'Settings advertise the new protocol without rewriting database prices')
    await fixture.order()
    assert.equal(fixture.rows.length, 1)
    const row = fixture.rows[0]
    assert.equal(row.pricing_version, version)
    assert.equal(row.bundle_discount, expected.bundleDiscount)
    assert.equal(row.original_price, expected.total)
    assert.equal(row.rider_income, Number((expected.total * 0.9).toFixed(2)), 'Commission uses the discounted order snapshot')
    assert.equal(JSON.stringify(fixture.settings), settingsSnapshot, 'Negotiation must not mutate shared tariff settings')
    fixture.body.quotedTotal = expected.total + 1
    await assert.rejects(fixture.order, error => error.code === 'PRICE_QUOTE_CHANGED')
    assert.equal(fixture.rows.length, 1, 'Reject mismatched old and new quotes before insertion')
  }
  for (const version of [undefined, 1, 4]) {
    const fixture = routeHarness('nanhai', version, 0)
    if (version === undefined) delete fixture.body.pricingVersion
    await assert.rejects(fixture.order, error => error.code === 'PRICING_VERSION_MISMATCH')
    assert.equal(fixture.rows.length, 0)
  }
  const coupon = { id: 'coupon', amount: 2, min_spend: 6, campus: 'nanhai' }
  const fixture = routeHarness('nanhai', 3, 4, coupon)
  await fixture.order() // 1 + 4 + 1 + 0.5 - 0.5 - 2 = 4
  assert.equal(fixture.rows[0].original_price, 6)
  assert.equal(fixture.rows[0].coupon_discount, 2)
  coupon.min_spend = 6.5
  await assert.rejects(fixture.order, error => error.code === 'COUPON_MIN_SPEND_NOT_MET')
  assert.equal(fixture.rows.length, 1)
  const client = loadPage()
  client.page.data.cards = []
  client.page.createOrder()
  assert.equal(client.submitted().pricingVersion, 3)
  await Promise.resolve()
}

async function main() {
  const cases = testParity()
  testBoundariesAndCoupons()
  await testRoutes()
  console.log(`Itemized bundle checks passed: ${cases} frontend/backend cases, fee thresholds, coupons, V2 compatibility, V3 snapshots and quote validation.`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
