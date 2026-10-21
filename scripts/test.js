const assert = require('assert')
const { calculatePrice } = require('../utils/pricing')
const { validateRegistration } = require('../utils/validators')
const { paginate } = require('../utils/pagination')
const { getAvailability, getDeadline } = require('../utils/time')
const { DEFAULT_SETTINGS, REVIEW_REGISTRATION_PROFILE } = require('../config/business')
const { DORM_BUILDINGS, BUSINESS, dormFloor } = require('../config/constants')
const {
  DORM_BUILDINGS: SERVER_DORM_BUILDINGS,
  MAX_ORDER_PIECES,
  MAX_PICKUP_IMAGES,
  MAX_DELIVERY_IMAGES,
  MAX_ITEMIZED_ORDER_ITEMS,
  normalizeDormBuilding,
  formatDormBuilding
} = require('../server/src/business-rules')
const { calculateItemizedPrice } = require('../server/src/item-pricing')
const { centsToMoney, moneyToCents, orderPayableCents } = require('../server/src/payment-money')
const { observationEndsAt, riderPrivateVisible } = require('../server/src/order-privacy')
const { selectBootstrapProfile } = require('../utils/mini-auth')
const { waitForAuthentication } = require('../utils/request')
const { canGrabOrder } = require('../utils/permissions')
const { getRiderProgress: getClientRiderProgress, RIDER_LEVELS: CLIENT_RIDER_LEVELS } = require('../utils/rider-level')
const {
  EXPERIENCE_PER_COMPLETED_ORDER,
  getRiderProgress: getServerRiderProgress,
  RIDER_LEVELS: SERVER_RIDER_LEVELS
} = require('../server/src/rider-level')
const {
  URGENT_ALERT_DELAY_MINUTES,
  URGENT_ALERT_SCAN_INTERVAL_MS,
  URGENT_ALERT_RETRY_DELAY_MINUTES,
  URGENT_ALERT_MAX_ATTEMPTS,
  buildUrgentAlertDetails,
  buildUrgentAlertEmail,
  hasCompletedPayment
} = require('../server/src/urgent-alert-rules')
const { classifySmtpFailure } = require('../server/src/urgent-email')

function testPricing() {
  assert.strictEqual(dormFloor('321'), 3)
  assert.strictEqual(dormFloor('421'), 4)
  assert.strictEqual(dormFloor(''), 0)
  assert.deepStrictEqual(
    calculatePrice({ urgency: 'today', scope: 'campus', pieces: 1, isLarge: false }, DEFAULT_SETTINGS),
    { total: 1, base: 1, pieces: 0, large: 0, building: 0, toDoor: 0 }
  )
  assert.deepStrictEqual(
    calculatePrice({ urgency: 'today', scope: 'off_campus', pieces: 2, isLarge: false }, DEFAULT_SETTINGS),
    { total: 3.5, base: 2, pieces: 1.5, large: 0, building: 0, toDoor: 0 }
  )
  assert.deepStrictEqual(
    calculatePrice({ urgency: 'urgent', scope: 'campus', pieces: 3, isLarge: true }, DEFAULT_SETTINGS),
    { total: 18, base: 8, pieces: 3, large: 7, building: 0, toDoor: 0 }
  )
  assert.deepStrictEqual(
    calculatePrice({ urgency: 'urgent', scope: 'off_campus', pieces: 1, isLarge: false }, DEFAULT_SETTINGS),
    { total: 9, base: 9, pieces: 0, large: 0, building: 0, toDoor: 0 }
  )
  assert.deepStrictEqual(
    calculatePrice({ urgency: 'today', scope: 'campus', pieces: 1, isLarge: false, toDoor: true }, DEFAULT_SETTINGS),
    { total: 2, base: 1, pieces: 0, large: 0, building: 0, toDoor: 1 }
  )
  assert.deepStrictEqual(
    calculatePrice({ urgency: 'today', scope: 'campus', pieces: 1, isLarge: false, building: '9栋' }, DEFAULT_SETTINGS),
    { total: 1.5, base: 1, pieces: 0, large: 0, building: 0.5, toDoor: 0 }
  )
  assert.deepStrictEqual(
    calculatePrice({ urgency: 'today', scope: 'campus', pieces: 1, isLarge: false, building: '9栋', toDoor: true }, DEFAULT_SETTINGS),
    { total: 2.5, base: 1, pieces: 0, large: 0, building: 0.5, toDoor: 1 }
  )
  assert.strictEqual(DEFAULT_SETTINGS.campusPrice, 1)
  assert.strictEqual(DEFAULT_SETTINGS.offCampusPrice, 2)
  assert.strictEqual(DEFAULT_SETTINGS.campusUrgentPrice, 8)
  assert.strictEqual(DEFAULT_SETTINGS.offCampusUrgentPrice, 9)
  assert.strictEqual(DEFAULT_SETTINGS.largePrice, 7)
  assert.strictEqual(DEFAULT_SETTINGS.toDoorFee, 1)
  assert.strictEqual(DEFAULT_SETTINGS.building9Surcharge, 1)
  assert.strictEqual(DEFAULT_SETTINGS.buildingSurcharge, 0.5)
  // 下单时间窗 08:00–20:00；送达截止另算 23:00，20:00 后停止接单以留出处理存量订单的时间
  assert.strictEqual(DEFAULT_SETTINGS.openTime, '08:00')
  assert.strictEqual(DEFAULT_SETTINGS.closeTime, '23:00')
  assert.strictEqual(DEFAULT_SETTINGS.cutoffHour, 20)
}

function testItemizedPricing() {
  const v1Settings = {
    item_small_campus_price: 1, item_small_off_campus_price: 2,
    item_medium_campus_price: 3, item_medium_off_campus_price: 4,
    item_large_campus_price: 5, item_large_off_campus_price: 6,
    item_urgent_fee: 5, item_door_fee: 1,
    bundle_tier1_threshold: 10, bundle_tier1_discount: 1,
    bundle_tier2_threshold: 20, bundle_tier2_discount: 3,
    commission_rate: 0, close_time: '23:00:00'
  }
  const today = calculateItemizedPrice([{ scope: 'campus', size: 'small', uploadId: 'a' }], 'today', true, v1Settings)
  assert.strictEqual(today.itemSubtotal, 1)
  assert.strictEqual(today.total, 1)
  assert.strictEqual(today.items[0].unitPrice, 1)
  const urgentDoor = calculateItemizedPrice([{ scope: 'campus', size: 'small', uploadId: 'a' }], 'urgent', false, v1Settings)
  assert.deepStrictEqual(
    { subtotal: urgentDoor.itemSubtotal, discount: urgentDoor.bundleDiscount, urgent: urgentDoor.urgencyFee, door: urgentDoor.doorFee, total: urgentDoor.total },
    { subtotal: 1, discount: 0, urgent: 5, door: 1, total: 7 }
  )
  const mixed = calculateItemizedPrice([
    { scope: 'off_campus', size: 'medium', uploadId: 'a' },
    { scope: 'campus', size: 'large', uploadId: 'b' }
  ], 'today', true, v1Settings)
  assert.strictEqual(mixed.total, 9)
  const tier1 = calculateItemizedPrice([
    { scope: 'off_campus', size: 'large', uploadId: 'a' },
    { scope: 'off_campus', size: 'large', uploadId: 'b' }
  ], 'today', true, v1Settings)
  assert.deepStrictEqual({ subtotal: tier1.itemSubtotal, discount: tier1.bundleDiscount, total: tier1.total }, { subtotal: 12, discount: 1, total: 11 })
  const tier2 = calculateItemizedPrice(Array.from({ length: 4 }, (_, index) => ({ scope: 'off_campus', size: 'large', uploadId: String(index) })), 'today', true, v1Settings)
  assert.deepStrictEqual({ subtotal: tier2.itemSubtotal, discount: tier2.bundleDiscount, total: tier2.total }, { subtotal: 24, discount: 3, total: 21 })

  const v2Settings = Object.assign({}, v1Settings, {
    item_pricing_version: 2,
    item_urgent_fee: 4,
    item_building_9_fee: 0.5,
    item_upper_floor_door_fee: 1.5,
    bundle_tier0_threshold: 5,
    bundle_tier0_discount: 0.5
  })
  const oneSmall = [{ scope: 'campus', size: 'small', uploadId: 'a' }]
  const building9UrgentDoor = calculateItemizedPrice(oneSmall, 'urgent', false, v2Settings, { building: '9栋', room: '811' })
  assert.deepStrictEqual(
    { version: building9UrgentDoor.pricingVersion, urgent: building9UrgentDoor.urgencyFee, door: building9UrgentDoor.doorFee, building: building9UrgentDoor.buildingFee, total: building9UrgentDoor.total },
    { version: 2, urgent: 4, door: 1, building: 0.5, total: 6.5 }
  )
  const floor3Door = calculateItemizedPrice(oneSmall, 'today', false, v2Settings, { building: '7栋', room: '321' })
  const floor4UrgentDoor = calculateItemizedPrice(oneSmall, 'urgent', false, v2Settings, { building: '7栋', room: '421' })
  assert.deepStrictEqual({ door: floor3Door.doorFee, total: floor3Door.total }, { door: 1, total: 2 })
  assert.deepStrictEqual({ door: floor4UrgentDoor.doorFee, total: floor4UrgentDoor.total }, { door: 1.5, total: 6.5 })
  const tier0 = calculateItemizedPrice([{ scope: 'campus', size: 'large', uploadId: 'a' }], 'today', true, v2Settings, { building: '7栋', room: '421' })
  assert.deepStrictEqual({ subtotal: tier0.itemSubtotal, discount: tier0.bundleDiscount, total: tier0.total }, { subtotal: 5, discount: 0.5, total: 4.5 })
  const eightAtBuilding9 = calculateItemizedPrice(
    Array.from({ length: 8 }, (_, index) => ({ scope: 'campus', size: 'small', uploadId: String(index) })),
    'today', true, v2Settings, { building: '9', room: '811' }
  )
  assert.deepStrictEqual({ subtotal: eightAtBuilding9.itemSubtotal, discount: eightAtBuilding9.bundleDiscount, building: eightAtBuilding9.buildingFee, total: eightAtBuilding9.total }, { subtotal: 8, discount: 0.5, building: 0.5, total: 8 })
  const oldClientAtBuilding9 = calculateItemizedPrice(oneSmall, 'urgent', false, v1Settings, { building: '9栋', room: '811' })
  assert.deepStrictEqual({ version: oldClientAtBuilding9.pricingVersion, door: oldClientAtBuilding9.doorFee, building: oldClientAtBuilding9.buildingFee, total: oldClientAtBuilding9.total }, { version: 1, door: 1, building: 0, total: 7 })
  assert.strictEqual(MAX_ITEMIZED_ORDER_ITEMS, 8)
}

function testPricingCacheMigration() {
  const previousWx = global.wx
  const reads = {}
  const existingOrders = [{ id: 'KD202609020001', originalPrice: 1.5 }]
  const storage = {
    campus_order_cache_version: 9,
    campus_orders: existingOrders,
    campus_user: { name: '小林' },
    campus_settings: {
      urgentPrice: 3,
      todayPrice: 1.5,
      tomorrowPrice: 1,
      extraPiecePrice: 0.5,
      largePrice: 2,
      reviewMode: false,
      serviceStatus: 'open'
    }
  }
  global.wx = {
    getStorageSync(key) { reads[key] = (reads[key] || 0) + 1; return storage[key] },
    setStorageSync(key, value) { storage[key] = value }
  }
  try {
    const store = require('../utils/store')
    store.ensureDemoData()
    assert.strictEqual(storage.campus_settings_nanhai.pricingVersion, DEFAULT_SETTINGS.pricingVersion)
    assert.strictEqual(storage.campus_settings_nanhai.campusPrice, 1)
    assert.strictEqual(storage.campus_settings_nanhai.offCampusPrice, 2)
    assert.strictEqual(storage.campus_settings_nanhai.campusUrgentPrice, 8)
    assert.strictEqual(storage.campus_settings_nanhai.offCampusUrgentPrice, 9)
    assert.strictEqual(storage.campus_settings_nanhai.extraPiecePrice, 1.5)
    assert.strictEqual(storage.campus_settings_nanhai.largePrice, 7)
    assert.strictEqual(storage.campus_settings_nanhai.toDoorFee, 1)
    assert.strictEqual(storage.campus_settings_nanhai.building9Surcharge, 1)
    assert.strictEqual(storage.campus_settings_nanhai.buildingSurcharge, 0.5)
    assert.strictEqual(storage.campus_settings_nanhai.closeTime, '23:00')
    assert.strictEqual(storage.campus_settings_nanhai.reviewMode, false)
    assert.strictEqual(storage.campus_settings_nanhai.serviceStatus, 'open')
    assert.deepStrictEqual(storage.campus_orders, existingOrders)
    assert.deepStrictEqual(storage.campus_user, { name: '小林' })
    store.getUser(); store.getOrders(); store.getSettings()
    const readsAfterWarmup = Object.assign({}, reads)
    store.getUser(); store.getOrders(); store.getSettings()
    assert.deepStrictEqual(reads, readsAfterWarmup)
  } finally {
    global.wx = previousWx
  }
}

function testRiderLevels() {
  assert.deepStrictEqual(CLIENT_RIDER_LEVELS, SERVER_RIDER_LEVELS)
  assert.deepStrictEqual(
    getClientRiderProgress(0),
    {
      experiencePoints: 0, level: 1, levelName: '新手骑手', currentLevelExperience: 0,
      nextLevelExperience: 100, experienceToNext: 100, progressPercent: 0,
      activeCount: 0, maxActiveOrders: 3, isMaxLevel: false
    }
  )
  assert.strictEqual(getClientRiderProgress(99).level, 1)
  assert.strictEqual(getClientRiderProgress(100).maxActiveOrders, 4)
  assert.strictEqual(getClientRiderProgress(300).maxActiveOrders, 5)
  assert.strictEqual(getClientRiderProgress(600).maxActiveOrders, 6)
  assert.strictEqual(getClientRiderProgress(1000).maxActiveOrders, 7)
  assert.strictEqual(getClientRiderProgress(1000).isMaxLevel, true)
  assert.deepStrictEqual(getClientRiderProgress({ experiencePoints: 300, activeCount: 2 }), getServerRiderProgress(300, 2))
  assert.strictEqual(EXPERIENCE_PER_COMPLETED_ORDER, 10)
  assert.strictEqual(canGrabOrder(3, 4), true)
  assert.strictEqual(canGrabOrder(4, 4), false)
}

function testValidation() {
  assert.strictEqual(validateRegistration({ name: '小林', phone: '13800009718', building: '9栋', room: '123' }), '')
  assert.strictEqual(validateRegistration({ name: '小林', phone: '13800009718', building: '25号楼', room: '123' }), '')
  assert.strictEqual(validateRegistration(REVIEW_REGISTRATION_PROFILE), '')
  assert.strictEqual(REVIEW_REGISTRATION_PROFILE.campus, 'nanhai')
  assert.strictEqual(REVIEW_REGISTRATION_PROFILE.building, '1栋')
  assert.strictEqual(REVIEW_REGISTRATION_PROFILE.room, '111')
  assert.match(validateRegistration({ name: '小林', phone: '13800009718', building: 'A栋', room: '123' }), /宿舍楼/)
  assert.match(validateRegistration({ name: '小林', phone: '13800009718', building: '25栋', room: '123' }), /宿舍楼/)
  assert.match(validateRegistration({ name: '', phone: '123', building: 'Z栋', room: '1' }), /称呼/)
}

function testReviewModeRegistration() {
  const localProfile = { name: '小林', phone: '13800009718', building: '2栋', room: '222' }
  assert.strictEqual(selectBootstrapProfile(null, { reviewMode: false, reviewProfile: REVIEW_REGISTRATION_PROFILE }), null)
  assert.strictEqual(selectBootstrapProfile(null, { reviewMode: true, reviewProfile: null }), null)
  assert.deepStrictEqual(selectBootstrapProfile(localProfile, { reviewMode: false, reviewProfile: REVIEW_REGISTRATION_PROFILE }), localProfile)
  assert.deepStrictEqual(selectBootstrapProfile(localProfile, { reviewMode: true, reviewProfile: REVIEW_REGISTRATION_PROFILE }), REVIEW_REGISTRATION_PROFILE)
}

async function testRegistrationCampusFallback() {
  const fs = require('fs')
  const path = require('path')
  const vm = require('vm')
  const constants = require('../config/constants')
  const source = fs.readFileSync(path.join(__dirname, '../pages/auth/welcome/welcome.js'), 'utf8')
  function load(reviewMode) {
    let definition
    const sheets = [], toasts = [], registrations = [], destinations = []
    const dependencies = {
      '../../../utils/page': value => { definition = value },
      '../../../utils/store': {
        getUser: () => null,
        getSettings: () => ({ reviewMode }),
        completeRegistration: user => user
      },
      '../../../utils/validators': require('../utils/validators'),
      '../../../utils/mini-auth': { register: profile => {
        registrations.push(profile)
        return Promise.resolve({ user: profile })
      } },
      '../../../utils/mode': { setMode: () => {} },
      '../../../config/constants': constants
    }
    vm.runInNewContext(source, {
      require: name => { assert.ok(dependencies[name], `Unexpected registration dependency: ${name}`); return dependencies[name] },
      getApp: () => ({ authReady: Promise.resolve({ registered: false }) }),
      wx: {
        showActionSheet: options => sheets.push(options),
        showToast: options => toasts.push(options),
        switchTab: options => destinations.push(options.url)
      }
    })
    const page = Object.assign({}, definition, {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(patch) { Object.assign(this.data, patch) }
    })
    page.onLoad()
    return { page, sheets, toasts, registrations, destinations }
  }
  for (let index = 0; index < constants.CAMPUSES.length; index++) {
    const run = load(false)
    await new Promise(resolve => setImmediate(resolve))
    const { page, sheets, registrations, destinations } = run
    page.inputName({ detail: { value: '小林' } })
    page.inputPhone({ detail: { value: '13800000000' } })
    page.inputRoom({ detail: { value: '421' } })
    page.toggleAgree()
    page.enter()
    assert.strictEqual(sheets.length, 1, 'Unselected campus must open a usable selection instead of only a toast')
    assert.deepStrictEqual(Array.from(sheets[0].itemList), constants.CAMPUS_LABELS)
    assert.strictEqual(registrations.length, 0, 'Never submit before explicit campus choice')
    assert.strictEqual(page.data.campus, '', 'Dismissing the sheet must not choose a campus')
    const formBefore = JSON.stringify(page.form)
    sheets[0].success({ tapIndex: index })
    assert.strictEqual(page.data.campus, constants.CAMPUSES[index])
    assert.strictEqual(page.data.campusIndex, index + 1)
    assert.deepStrictEqual(Array.from(page.data.buildings), constants.getDormBuildings(constants.CAMPUSES[index]))
    assert.strictEqual(page.data.roomRule, constants.getCampusConfig(constants.CAMPUSES[index]).roomRule)
    assert.strictEqual(JSON.stringify(page.form), formBefore, 'Campus fallback must preserve typed registration details')
    assert.strictEqual(page.data.agreed, true)
    assert.strictEqual(registrations.length, 0, 'Allow checking the campus-specific building before resubmitting')
    page.enter()
    await new Promise(resolve => setImmediate(resolve))
    assert.strictEqual(registrations.length, 1)
    assert.strictEqual(registrations[0].campus, constants.CAMPUSES[index])
    assert.strictEqual(registrations[0].room, '421')
    assert.deepStrictEqual(destinations, [constants.ROUTES.home])
    assert.strictEqual(page.data.submitting, false)
  }
  const review = load(true)
  await new Promise(resolve => setImmediate(resolve))
  review.page.enter()
  review.page.promptCampusSelection()
  assert.strictEqual(review.sheets.length, 0, 'Review mode must retain its existing registration behavior')
  assert.strictEqual(review.toasts[0].title, '请选择校区')
  const busy = load(false)
  busy.page.promptCampusSelection()
  assert.strictEqual(busy.sheets.length, 0, 'Do not open the fallback during authentication')
  await new Promise(resolve => setImmediate(resolve))
  busy.page.data.submitting = true
  busy.page.enter()
  busy.page.promptCampusSelection()
  assert.strictEqual(busy.sheets.length, 0, 'Do not open the fallback while registering')
}

async function testAuthenticationGate() {
  let releaseAuthentication
  let authenticated = false
  const authReady = new Promise(resolve => {
    releaseAuthentication = () => { authenticated = true; resolve() }
  })
  const protectedOptions = { url: '/mini/home' }
  const gated = waitForAuthentication(protectedOptions, { authReady }).then(result => {
    assert.strictEqual(authenticated, true)
    assert.strictEqual(result, protectedOptions)
  })
  releaseAuthentication()
  await gated

  const publicOptions = { url: '/mini/settings', skipAuth: true }
  assert.strictEqual(await waitForAuthentication(publicOptions, { authReady: new Promise(() => {}) }), publicOptions)
}

function testServerBusinessRules() {
  assert.deepStrictEqual(SERVER_DORM_BUILDINGS.map(formatDormBuilding), DORM_BUILDINGS)
  assert.strictEqual(MAX_ORDER_PIECES, BUSINESS.maxOrderPieces)
  assert.strictEqual(MAX_PICKUP_IMAGES, BUSINESS.maxUploadImages)
  assert.strictEqual(MAX_DELIVERY_IMAGES, 3)
  assert.strictEqual(normalizeDormBuilding('25号楼'), '25')
  assert.strictEqual(normalizeDormBuilding('25号栋'), '25')
  assert.strictEqual(formatDormBuilding('25'), '25号楼')
  assert.strictEqual(normalizeDormBuilding('9栋'), '9')
  assert.strictEqual(normalizeDormBuilding('h栋'), '')
  assert.strictEqual(normalizeDormBuilding('Z栋'), '')
}

function testHallFilters() {
  const { emptyFilters, buildFilterView, filterOrders } = require('../utils/order-filters')
  const orders = [
    { id: 'a', urgency: 'urgent', isLarge: false, pickupScope: 'campus', buildingGender: 'female', noUpstairs: false },
    { id: 'b', urgency: 'today', isLarge: true, pickupScope: 'campus', buildingGender: 'male', noUpstairs: false },
    { id: 'c', urgency: 'today', isLarge: true, pickupScope: 'off_campus', buildingGender: 'female', noUpstairs: true },
    { id: 'd', urgency: 'urgent', isLarge: false, pickupScope: 'off_campus', buildingGender: 'mixed', noUpstairs: true },
    { id: 'e', urgency: 'today', isLarge: false, pickupScope: 'mixed', pickupScopes: ['campus', 'off_campus'], buildingGender: 'female', noUpstairs: false }
  ]
  const ids = list => list.map(item => item.id)

  // 未选任何条件＝全量；空/非数组入参不炸
  assert.deepStrictEqual(ids(filterOrders(orders, emptyFilters())), ['a', 'b', 'c', 'd', 'e'])
  assert.deepStrictEqual(filterOrders(null, emptyFilters()), [])
  assert.deepStrictEqual(ids(filterOrders(orders, null)), ['a', 'b', 'c', 'd', 'e'])

  // 单维度
  assert.deepStrictEqual(ids(filterOrders(orders, Object.assign(emptyFilters(), { scope: 'campus' }))), ['a', 'b', 'e'])
  assert.deepStrictEqual(ids(filterOrders(orders, Object.assign(emptyFilters(), { type: 'large' }))), ['b', 'c'])
  assert.deepStrictEqual(ids(filterOrders(orders, Object.assign(emptyFilters(), { floor: 'upstairs' }))), ['a', 'b', 'e'])
  assert.deepStrictEqual(ids(filterOrders(orders, Object.assign(emptyFilters(), { floor: 'noUpstairs' }))), ['c', 'd'])

  // 核心：跨维度取交集（旧单选逻辑做不到），校内 且 女
  assert.deepStrictEqual(ids(filterOrders(orders, Object.assign(emptyFilters(), { scope: 'campus', gender: 'female' }))), ['a', 'e'])
  // 三维叠加：校外 且 女 且 不送上楼
  assert.deepStrictEqual(
    ids(filterOrders(orders, Object.assign(emptyFilters(), { scope: 'off_campus', gender: 'female', floor: 'noUpstairs' }))),
    ['c']
  )
  // 交集为空时返回空数组，不是报错
  assert.deepStrictEqual(filterOrders(orders, Object.assign(emptyFilters(), { type: 'large', gender: 'mixed' })), [])

  // 面板高亮与收起态 chip 同源：activeCount / activeChips / option.active 必须一致
  const view = buildFilterView({ urgency: '', type: 'large', scope: 'campus', gender: '', floor: '' })
  assert.strictEqual(view.activeCount, 2)
  assert.deepStrictEqual(view.activeChips, [{ key: 'type', label: '大件' }, { key: 'scope', label: '校内' }])
  assert.strictEqual(view.filterGroups.find(group => group.key === 'scope').options.find(option => option.value === 'campus').active, true)
  assert.strictEqual(view.filterGroups.find(group => group.key === 'scope').options.find(option => option.value === 'off_campus').active, false)
  // 每个维度的选项都在，且默认全不高亮
  assert.deepStrictEqual(view.filterGroups.map(group => group.key), ['urgency', 'type', 'scope', 'gender', 'floor'])
  assert.strictEqual(view.filterGroups.every(group => group.options.every(option => !option.active)), false)
  assert.strictEqual(buildFilterView(emptyFilters()).activeCount, 0)
  assert.strictEqual(buildFilterView(emptyFilters()).filterGroups.every(group => group.options.every(option => !option.active)), true)
}

function testPagination() {
  const result = paginate(Array.from({ length: 45 }, (_, index) => index), 2, 20)
  assert.strictEqual(result.items.length, 40)
  assert.strictEqual(result.hasMore, true)
  assert.strictEqual(result.total, 45)
}

function testTimeRules() {
  const beforeOpen = new Date(2026, 6, 14, 6, 30)
  const justBeforeOpen = new Date(2026, 6, 14, 7, 30)
  const morning = new Date(2026, 6, 14, 8, 30)
  const night = new Date(2026, 6, 14, 21, 30)
  // 窗口 08:00–20:00：「很急」「今天」共用同一窗口，8 点前两档都不可选
  assert.strictEqual(getAvailability(DEFAULT_SETTINGS, beforeOpen).urgent, false)
  assert.strictEqual(getAvailability(DEFAULT_SETTINGS, beforeOpen).today, false)
  assert.match(getAvailability(DEFAULT_SETTINGS, beforeOpen).reason, /08:00/)
  // 07:30 是本次窗口上移新增的边界：旧窗口 07:00 起算时它是可下单的，现在必须被挡住
  assert.strictEqual(getAvailability(DEFAULT_SETTINGS, justBeforeOpen).urgent, false)
  assert.strictEqual(getAvailability(DEFAULT_SETTINGS, justBeforeOpen).today, false)
  assert.match(getAvailability(DEFAULT_SETTINGS, justBeforeOpen).reason, /08:00/)
  assert.strictEqual(getAvailability(DEFAULT_SETTINGS, morning).urgent, true)
  assert.strictEqual(getAvailability(DEFAULT_SETTINGS, morning).today, true)
  assert.strictEqual(getAvailability(DEFAULT_SETTINGS, night).today, false)
  assert.strictEqual(getAvailability(DEFAULT_SETTINGS, night).urgent, false)
  assert.strictEqual(getDeadline('urgent', DEFAULT_SETTINGS, morning).text, '接单后1小时')
  assert.match(getDeadline('today', DEFAULT_SETTINGS, morning).text, /^今天/)
}

function testPaymentMoney() {
  assert.strictEqual(moneyToCents('1.50'), 150)
  assert.strictEqual(moneyToCents('0.01'), 1)
  assert.strictEqual(moneyToCents('1.001'), null)
  assert.strictEqual(moneyToCents('-1.00'), null)
  assert.strictEqual(centsToMoney(150), '1.50')
  assert.strictEqual(orderPayableCents({ original_price: '3.00', coupon_discount: '2.00' }), 100)
  assert.strictEqual(orderPayableCents({ original_price: '1.00', coupon_discount: '2.00' }), 0)
}

function testOrderPrivacy() {
  const completedAt = new Date('2026-08-26T00:00:00.000Z')
  const endsAt = observationEndsAt(completedAt, 24)
  assert.strictEqual(endsAt, completedAt.getTime() + 24 * 60 * 60 * 1000)
  assert.strictEqual(riderPrivateVisible(completedAt, 24, endsAt - 1), true)
  assert.strictEqual(riderPrivateVisible(completedAt, 24, endsAt), false)
  assert.strictEqual(riderPrivateVisible(null, 24, endsAt), true)
}

function testUrgentAlertRules() {
  assert.strictEqual(URGENT_ALERT_DELAY_MINUTES, 30)
  assert.strictEqual(URGENT_ALERT_SCAN_INTERVAL_MS, 10 * 60 * 1000)
  assert.strictEqual(URGENT_ALERT_RETRY_DELAY_MINUTES, 10)
  assert.strictEqual(URGENT_ALERT_MAX_ATTEMPTS, 3)
  assert.deepStrictEqual(
    buildUrgentAlertDetails({ id: 'KD20260903ABC12345', building: '7栋' }),
    { order: 'ABC12345', building: '7栋', minutes: '30' }
  )
  assert.deepStrictEqual(
    buildUrgentAlertDetails({ id: 'KD1234\r\n5678', building: '7栋\r\n异常值' }),
    { order: '12345678', building: '7栋 异常值', minutes: '30' }
  )
  const email = buildUrgentAlertEmail(
    { id: 'KD12345678', building: '1栋', phone: '13800000000', room: '9999' },
    'https://admin.scnutalk.com'
  )
  assert.match(email.subject, /12345678/)
  assert.doesNotMatch(email.subject, /KD12345678/)
  assert.match(email.text, /30 分钟/)
  assert.match(email.text, /1栋/)
  assert.match(email.text, /https:\/\/admin\.scnutalk\.com/)
  assert.doesNotMatch(email.text, /13800000000|9999/)
  assert.strictEqual(hasCompletedPayment({ paid_amount: 5, original_price: 5, coupon_discount: 0 }), true)
  assert.strictEqual(hasCompletedPayment({ paid_amount: 0, original_price: 2, coupon_discount: 2 }), true)
  assert.strictEqual(hasCompletedPayment({ paid_amount: 0, original_price: 5, coupon_discount: 2 }), false)
  assert.deepStrictEqual(
    classifySmtpFailure({ responseCode: 450, response: 'temporary rejection' }),
    { ok: false, code: 'SMTP_450', messageId: '', response: '' }
  )
  assert.strictEqual(classifySmtpFailure({ code: 'ETIMEDOUT' }), null)
}

async function run() {
  testPricing()
  testItemizedPricing()
  testPricingCacheMigration()
  testRiderLevels()
  testValidation()
  testReviewModeRegistration()
  await testRegistrationCampusFallback()
  await testAuthenticationGate()
  testServerBusinessRules()
  testHallFilters()
  testPagination()
  testTimeRules()
  testPaymentMoney()
  testOrderPrivacy()
  testUrgentAlertRules()
  console.log('Unit checks passed: legacy and itemized pricing, pricing cache migration, rider levels, validation, review registration, auth gate, server business rules, hall filters, pagination, delivery-time, payment-money, privacy and urgent-alert rules.')
}

run().catch(error => {
  console.error(error)
  process.exit(1)
})
