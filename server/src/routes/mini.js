const express = require('express')
const crypto = require('crypto')
const rateLimit = require('express-rate-limit')
const { pool, transaction } = require('../db')
const { asyncRoute, HttpError, ok } = require('../http')
const { requireMiniIdempotency, sendIdempotent } = require('../idempotency')
const validate = require('../validation')
const { writeAudit } = require('../audit')
const { lockCampusUser, autoChangeCampus } = require('../campus-change')
const { code2Session, imgSecCheck } = require('../wechat')
const {
  authenticateMini,
  decodeExpiry,
  issueMiniToken,
  issueRegistrationToken,
  verifyToken
} = require('../mini-auth')
const { uploadMiddleware, persistUpload, deleteUpload } = require('../uploads')
const { ensureThumbnail } = require('../thumbnail')
const { cancelLockedOrder, cancelUserOrder, processRefundByOrderId } = require('../payment-refunds')
const { queueUrgentOrderAlert, skipUrgentOrderAlert, requeueUrgentOrderAlert } = require('../urgent-alert-queue')
const { queueNewOrderRiderEmail, skipNewOrderRiderEmail, requeueNewOrderRiderEmail, notifyWithdrawalRequest } = require('../rider-notify')
const { observationEndsAt, observationHours, riderPrivateVisible } = require('../order-privacy')
const { EXPERIENCE_PER_COMPLETED_ORDER, getRiderProgress } = require('../rider-level')
const {
  ITEM_SCOPES,
  ITEM_SIZES,
  ITEMIZED_PRICING_CURRENT_VERSION,
  SOON_URGENCY_FEE,
  calculateItemizedPrice
} = require('../item-pricing')
const {
  MAX_ORDER_PIECES,
  MAX_PICKUP_IMAGES,
  MAX_DELIVERY_IMAGES,
  MAX_ITEMIZED_ORDER_ITEMS,
  SHIPAI_DORM_BUILDING_SET,
  normalizeDormBuilding,
  formatDormBuilding,
  emailSuspicion
} = require('../business-rules')
const {
  normalizeCampus,
  normalizeCampusLenient,
  getCampusConfig,
  stationLabel,
  DEFAULT_CAMPUS,
  CAMPUSES,
  CAMPUS_CONFIG
} = require('../campus-config')

const router = express.Router()
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'MINI_LOGIN_RATE_LIMITED', message: '登录请求过于频繁，请稍后重试' }
})

function normalizeBuilding(value, buildingKeys) {
  const keys = Array.isArray(buildingKeys) && buildingKeys.length ? buildingKeys : CAMPUS_CONFIG.nanhai.buildingKeys
  let building = String(value || '').trim().replace(/(?:号楼|号栋|栋)$/u, '').toUpperCase()
  if (keys.includes('东一') && building === '东1') building = '东一'
  if (!keys.includes(building)) throw new HttpError(400, '请选择宿舍楼', 'INVALID_BUILDING')
  return building
}

function normalizeRoom(value) {
  const result = String(value || '').trim()
  if (!/^\d{3,4}$/.test(result)) throw new HttpError(400, '请输入3至4位门牌号', 'INVALID_ROOM')
  return result
}

// 石牌楼栋：白名单校验；房号自由填（不按楼层计价，无需格式校验）。
function normalizeShipaiBuilding(value) {
  const building = String(value || '').trim()
  if (!SHIPAI_DORM_BUILDING_SET.has(building)) throw new HttpError(400, '请选择宿舍楼', 'INVALID_BUILDING')
  return building
}

function normalizeShipaiRoom(value) {
  return String(value == null ? '' : value).trim().slice(0, 50)
}

const DORM_BUILDING_GENDER = CAMPUS_CONFIG.nanhai.buildingGender
const BUILDING_GENDER_TEXT = { male: '男', female: '女', mixed: '混宿' }

// 楼栋性别（按楼层细分）：混宿楼栋按「宿舍号首位」判定楼层性别。
// 7栋：1-3层男、4层混、5-6层女；9栋：1-6层男、7-8层女；25号楼：整体混宿。
function buildingGender(building, room, genderTable) {
  const base = (genderTable || DORM_BUILDING_GENDER)[building] || ''
  if (base !== 'mixed') return base
  const floor = Number(String(room || '').trim().charAt(0)) || 0
  if (building === '7栋') {
    if (floor >= 1 && floor <= 3) return 'male'
    if (floor >= 5 && floor <= 6) return 'female'
    return 'mixed' // 4层 或未知楼层
  }
  if (building === '9栋') {
    if (floor >= 1 && floor <= 6) return 'male'
    if (floor >= 7 && floor <= 8) return 'female'
    return 'mixed' // 未知楼层
  }
  return 'mixed' // 25号楼
}

// 订单可接性统一评估：大厅观感（blocked 置灰）与 accept 拦截共用同一份规则，避免两端漂移。
// riderCtx: { userId, building, gender }；order 为 SQL 原始行（含 recently_transferred 标记）。
// 返回 { blocked, reason, code }；blocked=false 时可接。
function evaluateOrderGrab(riderCtx, order) {
  const campus = normalizeCampusLenient(order.campus)
  const cfg = getCampusConfig(campus)
  const grabRules = cfg && cfg.grabRules ? cfg.grabRules : null
  const noUpstairs = Number(order.no_upstairs)
  // 未支付（大厅 SQL 已隐藏此类，此处兜底 accept 直连 POST）
  if (Number(order.original_price) - Number(order.coupon_discount) > 0 && Number(order.paid_amount) <= 0) {
    return { blocked: true, reason: '订单尚未支付，无法接单', code: 'ORDER_NOT_PAID' }
  }
  // 刚转出（禁接期内）的单
  if (order.recently_transferred) {
    return { blocked: true, reason: '刚转出的订单不能立即接回', code: 'CANNOT_RECLAIM_TRANSFERRED_ORDER' }
  }
  // 自己发布的单
  if (String(order.user_id) === String(riderCtx.userId)) {
    return { blocked: true, reason: '不能接自己的订单', code: 'CANNOT_ACCEPT_OWN_ORDER' }
  }
  // 本栋限制（石牌）：送上楼且不是本栋 → 不可接
  if (grabRules && grabRules.ownBuildingOnly && !noUpstairs
      && String(riderCtx.building || '').trim() !== String(order.building || '').trim()) {
    return { blocked: true, reason: '石牌校区仅可接本栋楼或"楼下自取"的订单', code: 'SHIPAI_BUILDING_MISMATCH' }
  }
  // 性别限制（南海）：送上楼 + 非豁免楼栋(9栋) + 骑手已填性别 + 异性 → 不可接
  const genderRule = grabRules && grabRules.genderRestriction ? grabRules.genderRestriction : null
  if (genderRule && genderRule.enabled && !noUpstairs && riderCtx.gender
      && !(genderRule.exemptBuildings || []).includes(normalizeDormBuilding(order.building))) {
    const genderTable = (cfg && cfg.buildingGender) || DORM_BUILDING_GENDER
    const orderGender = buildingGender(formatDormBuilding(order.building, campus), order.room, genderTable)
    if (orderGender && orderGender !== 'mixed' && orderGender !== riderCtx.gender) {
      return { blocked: true, reason: '送上楼的订单仅限同性骑手接单', code: 'NANHAI_GENDER_MISMATCH' }
    }
  }
  return { blocked: false, reason: '', code: '' }
}

function readProfile(body) {
  const campus = normalizeCampus(body && body.campus)
  if (!campus) throw new HttpError(400, '请选择校区', 'INVALID_CAMPUS')
  const name = validate.string(body && body.name, '称呼', { min: 1, max: 12 })
  const phone = validate.phone(body && body.phone)
  const cfg = getCampusConfig(campus)
  if (cfg && cfg.roomRule === 'free') {
    return {
      campus, name, phone,
      building: normalizeShipaiBuilding(body && body.building),
      room: normalizeShipaiRoom(body && body.room),
      address: ''
    }
  }
  return {
    campus,
    name,
    phone,
    building: normalizeBuilding(body && body.building, cfg && cfg.buildingKeys),
    room: normalizeRoom(body && body.room),
    address: ''
  }
}

function mapUser(row) {
  const riderStatus = row.rider_status || row.application_status || 'none'
  const riderProgress = row.rider_status ? getRiderProgress(row.experience_points) : null
  return {
    id: String(row.id),
    name: row.nickname || '同学',
    phone: row.phone || '',
    building: formatDormBuilding(row.building, row.campus) || '',
    room: row.room || '',
    campus: normalizeCampusLenient(row.campus),
    address: row.address || '',
    riderEmail: row.rider_email || '',
    riderApproved: row.rider_status === 'approved',
    riderStatus,
    validOvertimes: Number(row.valid_overtimes) || 0,
    experiencePoints: riderProgress ? riderProgress.experiencePoints : 0,
    riderLevel: riderProgress ? riderProgress.level : 1,
    riderLevelName: riderProgress ? riderProgress.levelName : '新手骑手',
    maxActiveOrders: riderProgress ? riderProgress.maxActiveOrders : 3,
    riderProgress,
    registeredAt: row.created_at instanceof Date ? row.created_at.getTime() : Date.parse(row.created_at) || Date.now(),
    profileUpdatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(row.updated_at) || Date.now()
  }
}

async function findUserByOpenid(executor, openid, lock = false) {
  const [rows] = await executor.execute(
    `SELECT u.id, u.openid, u.unionid, u.nickname, u.phone, u.building, u.room, u.campus, u.address, u.status,
            u.created_at, u.updated_at, r.status AS rider_status, r.valid_overtimes, r.experience_points,
            r.email AS rider_email, ra.status AS application_status
       FROM users u
       LEFT JOIN riders r ON r.user_id = u.id
       LEFT JOIN rider_applications ra ON ra.id = (
         SELECT MAX(ra2.id) FROM rider_applications ra2 WHERE ra2.user_id = u.id
       )
      WHERE u.openid = ?
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [openid]
  )
  return rows[0] || null
}

async function findUserById(executor, id) {
  const [rows] = await executor.execute(
    `SELECT u.id, u.openid, u.unionid, u.nickname, u.phone, u.building, u.room, u.campus, u.address, u.status,
            u.created_at, u.updated_at, r.status AS rider_status, r.valid_overtimes, r.experience_points,
            r.email AS rider_email, ra.status AS application_status
       FROM users u
       LEFT JOIN riders r ON r.user_id = u.id
       LEFT JOIN rider_applications ra ON ra.id = (
         SELECT MAX(ra2.id) FROM rider_applications ra2 WHERE ra2.user_id = u.id
       )
      WHERE u.id = ?
      LIMIT 1`,
    [id]
  )
  return rows[0] || null
}

function sessionPayload(user) {
  const token = issueMiniToken(user.id)
  return {
    registered: true,
    token,
    expiresAt: decodeExpiry(token),
    user: mapUser(user)
  }
}

router.post('/auth/login', loginLimiter, asyncRoute(async (request, response) => {
  const code = validate.string(request.body && request.body.code, '微信登录凭证', { min: 4, max: 128 })
  const identity = await code2Session(code)
  const user = await findUserByOpenid(pool, identity.openid)
  if (!user) {
    const registrationToken = issueRegistrationToken(identity)
    return ok(response, {
      registered: false,
      registrationToken,
      expiresAt: decodeExpiry(registrationToken)
    })
  }
  if (user.status !== 'active') throw new HttpError(403, '用户账号已被停用', 'MINI_ACCOUNT_DISABLED')
  return ok(response, sessionPayload(user))
}))

router.post('/auth/register', loginLimiter, asyncRoute(async (request, response) => {
  const registrationToken = validate.string(request.body && request.body.registrationToken, '注册凭证', { min: 20, max: 2048 })
  const identity = verifyToken(registrationToken, 'mini_registration')
  const profile = readProfile(request.body || {})

  const result = await transaction(async connection => {
    let user = await findUserByOpenid(connection, String(identity.sub), true)

    if (!user) {
      const [created] = await connection.execute(
        `INSERT INTO users
           (openid, unionid, nickname, phone, building, room, campus, address, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [String(identity.sub), String(identity.unionid || '') || null, profile.name, profile.phone, profile.building, profile.room, profile.campus, profile.address]
      )
      user = await findUserById(connection, created.insertId)
    } else {
      if (user.status !== 'active') throw new HttpError(403, '用户账号已被停用', 'MINI_ACCOUNT_DISABLED')
      if (normalizeCampusLenient(user.campus) !== profile.campus) {
        throw new HttpError(409, '已有账号请通过变更校区入口转校区', 'CAMPUS_CHANGE_REQUIRED')
      }
      await connection.execute(
        `UPDATE users
            SET nickname = ?, phone = ?, building = ?, room = ?, campus = ?, address = ?, updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [profile.name, profile.phone, profile.building, profile.room, profile.campus, profile.address, user.id]
      )
      user = await findUserById(connection, user.id)
    }

    return { user }
  })

  return ok(response, sessionPayload(result.user), 201)
}))

router.get('/me', authenticateMini, asyncRoute(async (request, response) => {
  await reconcileOrderLifecycle()
  const user = await findUserById(pool, request.miniUser.id)
  return ok(response, { user: mapUser(user) })
}))

// 审核模式开关 — 前端据此隐藏/显示支付相关功能
router.get('/settings', asyncRoute(async (request, response) => {
  const rawCampus = String((request.query && request.query.campus) || '').trim()
  const campus = rawCampus ? normalizeCampus(rawCampus) : DEFAULT_CAMPUS
  if (!campus) throw new HttpError(400, '未知校区', 'INVALID_CAMPUS')
  return ok(response, await readMiniSettings(pool, campus))
}))

router.put('/me', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  // 与转区串行，避免旧校区请求在转区后重新写回旧地址。
  const user = await transaction(async connection => {
    const current = await lockCampusUser(connection, request.miniUser.id, request.miniUser.campus)
    if (request.body && request.body.campus && request.body.campus !== current.campus) {
      throw new HttpError(409, '校区已变更，请刷新后重新填写地址', 'CAMPUS_CHANGED')
    }
    const profile = readProfile(Object.assign({}, request.body || {}, { campus: current.campus }))
    await connection.execute(
      `UPDATE users
          SET nickname = ?, phone = ?, building = ?, room = ?, address = ?, updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [profile.name, profile.phone, profile.building, profile.room, profile.address, request.miniUser.id]
    )
    return findUserById(connection, request.miniUser.id)
  })
  return sendIdempotent(request, response, { user: mapUser(user) })
}))

const feedbackCategories = ['suggestion', 'problem', 'other']

router.post('/feedback', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const category = validate.oneOf(request.body && request.body.category, '意见类型', feedbackCategories)
  const content = validate.string(request.body && request.body.content, '意见内容', { min: 2, max: 500 })
  const [countRows] = await pool.execute(
    // 每日上限按北京自然日：别用 DATE_SUB(UTC_DATE(), INTERVAL 8 HOUR)，那是 UTC 日期，北京 00:00–08:00 会差一天。
    'SELECT COUNT(*) AS total FROM feedbacks WHERE user_id = ? AND created_at >= DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)), INTERVAL 8 HOUR)',
    [request.miniUser.id]
  )
  if (Number(countRows[0].total) >= 3) throw new HttpError(409, '每天最多提交3条意见', 'FEEDBACK_DAILY_LIMIT')
  const [created] = await pool.execute(
    `INSERT INTO feedbacks (user_id, category, content, status, created_at, updated_at)
     VALUES (?, ?, ?, 'unread', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [request.miniUser.id, category, content]
  )
  return sendIdempotent(request, response, { id: String(created.insertId), status: 'unread' }, 201)
}))

const orderStatusText = Object.freeze({
  unpaid: '待支付',
  waiting: '等待骑手接单', accepted: '骑手已接单', picked: '骑手已取件',
  delivering: '骑手正在配送中', delivered: '骑手已送达', completed: '已完成',
  cancelled: '已取消', disputed: '客服处理中'
})
const refundStatusText = Object.freeze({
  pending: '退款待处理', processing: '退款处理中', succeeded: '退款已完成',
  retryable: '退款等待重试', manual_review: '退款需人工核对'
})
const urgencyText = Object.freeze({ urgent: '很急', soon: '稍急', today: '今天', tomorrow: '明天' })
const pickupScopeText = Object.freeze({ campus: '校内', campus_7: '校内', off_campus: '校外' })
const itemSizeText = Object.freeze({ small: '小件', medium: '中件', large: '大件' })

function unixMilliseconds(value) {
  return value instanceof Date ? value.getTime() : Date.parse(value) || 0
}

function createOrderId() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).reduce((result, item) => Object.assign(result, { [item.type]: item.value }), {})
  return `KD${parts.year}${parts.month}${parts.day}${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

function parseItemDetails(value) {
  if (!value) return []
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => item && ITEM_SCOPES.includes(item.scope) && ITEM_SIZES.includes(item.size))
  } catch (error) {
    return []
  }
}

function mapOrder(row, options = {}) {
  const pickupAttachmentIds = String(row.pickup_attachment_ids || row.attachment_ids || row.attachment_id || '')
    .split(',').filter(Boolean)
  const deliveryAttachmentIds = String(row.delivery_attachment_ids || '').split(',').filter(Boolean)
  const completedAtMs = unixMilliseconds(row.completed_at)
  const deliveredAtMs = unixMilliseconds(row.delivered_at)
  const configuredObservationHours = observationHours(row.observation_hours)
  const observationEndsAtMs = observationEndsAt(row.completed_at, configuredObservationHours)
  const now = Date.now()
  const campus = normalizeCampusLenient(row.campus)
  const campusCfg = getCampusConfig(campus)
  const includePrivate = options.includePrivate === true
  const gender = buildingGender(formatDormBuilding(row.building, campus), row.room, campusCfg && campusCfg.buildingGender)
  const rawItems = parseItemDetails(row.item_details_json)
  const stationLabelOf = scope => {
    const list = campusCfg && Array.isArray(campusCfg.scopeStations) ? campusCfg.scopeStations : []
    const station = list.find(s => s.value === scope)
    if (!station) return ''
    const title = station.title || ''
    const label = station.label ? String(station.label).replace(/\n/g, '') : ''
    return [title, label].filter(Boolean).join(' ')
  }
  const items = rawItems.map((item, index) => ({
    index: Number(item.index) || index + 1,
    scope: item.scope,
    scopeText: pickupScopeText[item.scope] || item.scope,
    scopeLabel: stationLabelOf(item.scope) || pickupScopeText[item.scope] || item.scope,
    size: item.size,
    sizeText: itemSizeText[item.size] || item.size,
    unitPrice: Number(item.unitPrice) || 0,
    imageUrl: includePrivate && item.uploadId
      ? `/mini/orders/${encodeURIComponent(row.id)}/attachments/${encodeURIComponent(item.uploadId)}`
      : ''
  }))
  // 整单取件范围归一化：campus_7（校内7栋后门多多买菜）与 campus 同属「校内」，避免被误判成 mixed（校内+校外）
  const itemScopes = [...new Set(items.map(item => (item.scope === 'campus_7' ? 'campus' : item.scope)))]
  const mappedScope = itemScopes.length > 1 ? 'mixed' : (itemScopes[0] || row.pickup_scope || '')
  const hasStation = Boolean(campusCfg && campusCfg.stations && campusCfg.stations.length)
  const pickupStationText = stationLabel(campus, row.pickup_station)
  return {
    id: row.id,
    status: row.status,
    statusText: orderStatusText[row.status] || row.status,
    campus,
    address: row.address || '',
    pickupStation: row.pickup_station || '',
    pickupStationText,
    urgency: row.urgency,
    urgencyText: urgencyText[row.urgency] || row.urgency,
    pickupScope: hasStation ? '' : mappedScope,
    pickupScopes: hasStation ? [] : (itemScopes.length ? itemScopes : (row.pickup_scope ? [row.pickup_scope] : [])),
    pickupScopeText: hasStation ? '' : (mappedScope === 'mixed' ? '校内+校外' : (pickupScopeText[mappedScope] || '')),
    pieces: Number(row.pieces) || 1,
    isLarge: Boolean(row.is_large),
    noUpstairs: Boolean(row.no_upstairs),
    building: formatDormBuilding(row.building, campus),
    buildingGender: gender,
    buildingGenderText: BUILDING_GENDER_TEXT[gender] || '',
    room: includePrivate ? (row.room || '') : '',
    phone: includePrivate ? (row.phone || '') : '',
    contactName: includePrivate ? (row.contact_name || '') : '',
    note: includePrivate ? (row.note || '') : '',
    pricingModel: row.pricing_model || 'legacy',
    items,
    itemSubtotal: Number(row.item_subtotal) || 0,
    bundleDiscount: Number(row.bundle_discount) || 0,
    urgencyFee: Number(row.urgency_fee) || 0,
    doorFee: Number(row.door_fee) || 0,
    buildingFee: Number(row.building_fee) || 0,
    pricingVersion: Math.max(1, Math.floor(Number(row.pricing_version) || 1)),
    originalPrice: Number(row.original_price) || 0,
    price: Number(row.rider_income) || 0,
    discountAmount: Number(row.coupon_discount) || 0,
    paidAmount: Number(row.paid_amount) || 0,
    riderName: row.rider_name || '',
    riderPhone: options.includeRiderPhone ? (row.rider_phone || '') : '',
    deadlineAt: unixMilliseconds(row.deadline_at),
    deadline: row.deadline_text || deadlineText(row.urgency, row.close_time),
    // 保留 deadline 供审核及旧包使用，正常模式的新包展示从下单起算的时限。
    deliveryDeadline: row.urgency === 'urgent' ? '下单后 1 小时'
      : row.urgency === 'soon' ? '下单后 4 小时' : (row.deadline_text || deadlineText(row.urgency, row.close_time)),
    createdAtMs: unixMilliseconds(row.created_at),
    acceptedAtMs: unixMilliseconds(row.accepted_at),
    deliveredAtMs,
    completedAtMs,
    autoCompleteAt: deliveredAtMs ? deliveredAtMs + 12 * 60 * 60 * 1000 : 0,
    observationHours: configuredObservationHours,
    observationEndsAt: observationEndsAtMs,
    financialStatus: completedAtMs
      ? (row.settled_at || now >= observationEndsAtMs ? 'available' : 'observation')
      : row.status === 'disputed' ? 'frozen' : '',
    refundStatus: row.refund_status || '',
    refundStatusText: refundStatusText[row.refund_status] || '',
    refundAmount: Number(row.refund_amount) || 0,
    accepted: ['accepted', 'picked', 'delivering', 'delivered', 'completed'].includes(row.status),
    screenshots: includePrivate ? pickupAttachmentIds.map(id => `/mini/orders/${encodeURIComponent(row.id)}/attachments/${encodeURIComponent(id)}`) : [],
    deliveryImages: includePrivate ? deliveryAttachmentIds.map(id => `/mini/orders/${encodeURIComponent(row.id)}/attachments/${encodeURIComponent(id)}`) : []
  }
}

const orderSelect = `SELECT o.*, COALESCE(NULLIF(r.name_note,''), r.name) AS rider_name, r.phone AS rider_phone,
  (SELECT observation_hours FROM platform_settings WHERE id = 1 LIMIT 1) AS observation_hours,
  (SELECT close_time FROM platform_settings WHERE id = 1 LIMIT 1) AS close_time,
  (SELECT refund.status FROM order_refunds refund WHERE refund.order_id = o.id LIMIT 1) AS refund_status,
  (SELECT refund.amount FROM order_refunds refund WHERE refund.order_id = o.id LIMIT 1) AS refund_amount,
  (SELECT GROUP_CONCAT(oa_pickup.upload_id) FROM order_attachments oa_pickup
    WHERE oa_pickup.order_id = o.id AND oa_pickup.kind = 'pickup') AS pickup_attachment_ids,
  (SELECT GROUP_CONCAT(oa_delivery.upload_id) FROM order_attachments oa_delivery
    WHERE oa_delivery.order_id = o.id AND oa_delivery.kind = 'delivery') AS delivery_attachment_ids
  FROM orders o
  LEFT JOIN riders r ON r.id = o.rider_id`

async function findOrder(executor, orderId, lock = false) {
  const [rows] = await executor.execute(
    `${orderSelect} WHERE o.id = ?${lock ? ' FOR UPDATE' : ''}`,
    [orderId]
  )
  return rows[0] || null
}

function formatCloseTime(value) {
  const s = String(value || '').slice(0, 5)
  return /^\d{2}:\d{2}$/.test(s) ? s : '20:00'
}

function deadlineText(urgency, closeTime) {
  if (urgency === 'urgent') return '接单后 1 小时'
  if (urgency === 'soon') return '下单后 4 小时'
  const close = formatCloseTime(closeTime)
  return urgency === 'tomorrow' ? `明天 ${close}` : `今天 ${close}`
}

// 计算订单预订送达时间的 UTC 时间戳（存库用，供「超时未接单自动退款」判断）
function computeDeadlineAt(urgency, closeTime) {
  const now = Date.now()
  if (urgency === 'urgent' || urgency === 'soon') {
    const hours = urgency === 'soon' ? 4 : 1
    return new Date(now + hours * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  }
  // today/tomorrow：按北京日期的 close_time 截止；北京 = UTC + 8 小时
  const [hour, minute] = formatCloseTime(closeTime).split(':').map(Number)
  const closeHour = Number.isFinite(hour) ? hour : 22
  const closeMinute = Number.isFinite(minute) ? minute : 0
  const bj = new Date(now + 8 * 60 * 60 * 1000)
  let ts = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate(), closeHour - 8, closeMinute, 0, 0)
  if (urgency === 'tomorrow') ts += 24 * 60 * 60 * 1000
  return new Date(ts).toISOString().slice(0, 19).replace('T', ' ')
}

function hasUserAccess(order, userId) {
  return order && String(order.user_id) === String(userId)
}

async function hasRiderAccess(executor, order, userId) {
  if (!order || !order.rider_id) return false
  const rider = await currentRider(executor, userId)
  return rider && String(rider.id) === String(order.rider_id)
}

// Reconcile time-based order transitions whenever a mini-program API is read.
// This avoids a separate cron dependency while preserving the 12h auto-confirm and
// 24h observation rules for the initial launch.
// When called with the default pool (from GET routes), the three UPDATE steps are
// wrapped in a single transaction so that a mid-flight crash cannot leave orders
// marked completed without freezing income, or income frozen without settling.
let lifecycleReconcileTask = null
let lifecycleReconciledAt = 0

// Keep the historical event key so an order already rewarded by an older release
// cannot receive a second award under a renamed event type.
const COMPLETED_ORDER_EXPERIENCE_EVENT_TYPE = 'order_settled'

async function awardCompletedOrderExperience(connection, orderId = '') {
  const orderFilter = orderId ? 'AND o.id = ?' : ''
  const params = [
    COMPLETED_ORDER_EXPERIENCE_EVENT_TYPE,
    EXPERIENCE_PER_COMPLETED_ORDER,
    COMPLETED_ORDER_EXPERIENCE_EVENT_TYPE
  ]
  if (orderId) params.push(orderId)

  await connection.execute(
    `INSERT INTO rider_experience_events (rider_id, order_id, event_type, points, created_at)
     SELECT o.rider_id, o.id, ?, ?, UTC_TIMESTAMP()
       FROM orders o
       JOIN platform_settings settings ON settings.id = 1
      WHERE o.status = 'completed'
        AND o.completed_at IS NOT NULL
        AND o.rider_id IS NOT NULL
        AND settings.rider_experience_started_at IS NOT NULL
        AND o.created_at >= settings.rider_experience_started_at
        AND NOT EXISTS (
          SELECT 1
            FROM rider_experience_events existing
           WHERE existing.order_id = o.id AND existing.event_type = ?
        )
        ${orderFilter}
     ON DUPLICATE KEY UPDATE order_id = VALUES(order_id)`,
    params
  )
  await connection.execute(
    `UPDATE riders r
     JOIN (
       SELECT rider_id, SUM(points) AS total_points
         FROM rider_experience_events
        GROUP BY rider_id
     ) totals ON totals.rider_id = r.id
        SET r.experience_points = totals.total_points,
            r.updated_at = UTC_TIMESTAMP()
      WHERE r.experience_points <> totals.total_points`
  )
}

async function reconcileOrderLifecycle(executor = pool) {
  async function run(conn) {
    // 自动取消超过10分钟未支付的订单。逐行加锁后复用统一取消流程，避免与支付回调交错。
    const [expiredUnpaidOrders] = await conn.execute(
      `SELECT id, user_id, status, paid_amount, payment_aoid
         FROM orders
        WHERE status = 'unpaid'
          AND COALESCE(payment_expires_at, DATE_ADD(created_at, INTERVAL 10 MINUTE)) <= UTC_TIMESTAMP()
        ORDER BY created_at ASC
        LIMIT 100
        FOR UPDATE`
    )
    for (const order of expiredUnpaidOrders) await cancelLockedOrder(conn, order, 'payment_timeout')
    await conn.execute(
      "UPDATE orders SET status = 'completed', completed_at = DATE_ADD(delivered_at, INTERVAL 12 HOUR), updated_at = UTC_TIMESTAMP() WHERE status = 'delivered' AND delivered_at IS NOT NULL AND delivered_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 HOUR)"
    )
    await conn.execute(
      `UPDATE riders r
          JOIN (
            SELECT rider_id, COALESCE(SUM(rider_income), 0) AS frozen_total
              FROM orders
             WHERE status = 'completed' AND income_frozen_at IS NULL AND withhold_rider_income = 0
             GROUP BY rider_id
          ) agg ON agg.rider_id = r.id
          SET r.frozen_balance = r.frozen_balance + agg.frozen_total,
              r.updated_at = UTC_TIMESTAMP()`
    )
    await conn.execute(
      "UPDATE orders SET income_frozen_at = UTC_TIMESTAMP() WHERE status = 'completed' AND income_frozen_at IS NULL AND withhold_rider_income = 0"
    )
    await awardCompletedOrderExperience(conn)
    await conn.execute(
      `UPDATE riders r
          JOIN (
            SELECT o.rider_id, COALESCE(SUM(o.rider_income), 0) AS settle_total
              FROM orders o
              JOIN platform_settings settings ON settings.id = 1
             WHERE o.status = 'completed' AND o.income_frozen_at IS NOT NULL AND o.settled_at IS NULL AND o.withhold_rider_income = 0
               AND DATE_ADD(o.completed_at, INTERVAL settings.observation_hours HOUR) <= UTC_TIMESTAMP()
             GROUP BY o.rider_id
          ) agg ON agg.rider_id = r.id
          SET r.available_balance = r.available_balance + agg.settle_total,
              r.frozen_balance = GREATEST(r.frozen_balance - agg.settle_total, 0),
              r.updated_at = UTC_TIMESTAMP()`
    )
    await conn.execute(
      `UPDATE orders o
          JOIN platform_settings settings ON settings.id = 1
          SET o.settled_at = UTC_TIMESTAMP()
        WHERE o.status = 'completed' AND o.income_frozen_at IS NOT NULL AND o.settled_at IS NULL AND o.withhold_rider_income = 0
          AND DATE_ADD(o.completed_at, INTERVAL settings.observation_hours HOUR) <= UTC_TIMESTAMP()`
    )
  }
  // Already inside a caller-provided transaction — run directly on the connection.
  if (executor !== pool) return run(executor)
  // Coalesce concurrent reads and avoid running four lifecycle UPDATEs on every page request.
  if (lifecycleReconcileTask) return lifecycleReconcileTask
  if (Date.now() - lifecycleReconciledAt < 10 * 1000) return undefined
  lifecycleReconcileTask = transaction(run).then(result => {
    lifecycleReconciledAt = Date.now()
    return result
  }).finally(() => { lifecycleReconcileTask = null })
  return lifecycleReconcileTask
}

const BUILDING9_SURCHARGE = 0.5
// 2026-09-14 上门加价按楼栋：9栋有电梯送上门简单 +0.5，其他楼 +1。9栋不再单独加价。
// noUpstairs=false = 送上门（9栋 +BUILDING9_SURCHARGE、其他楼 +TO_DOOR_FEE）；noUpstairs=true = 楼下自取 +0。
const TO_DOOR_FEE = 1
// 转单防滥用两道刹车（2026-09-12 用户拍板）。接单会解锁用户手机号/房间号，
// 不加刹车等于开出一条「接单看号 → 转单 → 再接」的数据采集路径。
const TRANSFER_RECLAIM_BLOCK_HOURS = 2
const TRANSFER_DAILY_LIMIT = 3

async function platformPricing(executor, urgency, pieces, isLarge, scope, building, noUpstairs, campus = 'nanhai') {
  const [rows] = await executor.execute('SELECT campus_price, off_campus_price, campus_urgent_price, off_campus_urgent_price, extra_piece_price, large_price, commission_rate, close_time FROM platform_settings WHERE campus = ? LIMIT 1', [campus])
  const settings = rows[0]
  if (!settings) throw new HttpError(503, '平台设置尚未初始化', 'SETTINGS_NOT_INITIALIZED')
  const offCampus = scope === 'off_campus'
  const base = urgency === 'urgent'
    ? (offCampus ? Number(settings.off_campus_urgent_price) : Number(settings.campus_urgent_price))
    : (offCampus ? Number(settings.off_campus_price) : Number(settings.campus_price))
  const toDoorFee = noUpstairs ? 0 : (normalizeDormBuilding(building) === '9' ? BUILDING9_SURCHARGE : TO_DOOR_FEE)
  return {
    total: Number((base + (pieces - 1) * Number(settings.extra_piece_price) + (isLarge ? Number(settings.large_price) : 0) + toDoorFee).toFixed(2)),
    commissionRate: Number(settings.commission_rate) || 0,
    closeTime: formatCloseTime(settings.close_time)
  }
}

async function itemizedPricing(executor, items, urgency, noUpstairs, address, requestedVersion, campus = 'nanhai') {
  const [rows] = await executor.execute(
    `SELECT item_pricing_version,
            item_small_campus_price, item_small_off_campus_price,
            item_medium_campus_price, item_medium_off_campus_price,
            item_large_campus_price, item_large_off_campus_price,
            item_urgent_fee, item_door_fee, item_building_9_fee, item_upper_floor_door_fee,
            bundle_tier0_threshold, bundle_tier0_discount,
            bundle_tier1_threshold, bundle_tier1_discount,
            bundle_tier2_threshold, bundle_tier2_discount,
            commission_rate, close_time
       FROM platform_settings WHERE campus = ? LIMIT 1`,
    [campus]
  )
  const current = rows[0]
  if (!current) throw new HttpError(503, '平台设置尚未初始化', 'SETTINGS_NOT_INITIALIZED')
  const serverVersion = Math.max(1, Math.floor(Number(current.item_pricing_version) || 1))
  // 基础费率沿用数据库 V2 配置；按客户端协议选择满减口径，无需改价或重算旧单。
  if (![2, ITEMIZED_PRICING_CURRENT_VERSION].includes(requestedVersion) || ![2, ITEMIZED_PRICING_CURRENT_VERSION].includes(serverVersion)) {
    throw new HttpError(409, '价格规则已更新，请重新进入小程序后再下单', 'PRICING_VERSION_MISMATCH')
  }
  const campusCfg = getCampusConfig(campus)
  return calculateItemizedPrice(items, urgency, noUpstairs, Object.assign({}, current, { item_pricing_version: requestedVersion }), address, Boolean(campusCfg && campusCfg.building9Fee))
}

async function readServiceStatus(executor = pool) {
  const settings = await readMiniSettings(executor)
  return { status: settings.serviceStatus, notice: settings.serviceNotice }
}

async function readMiniSettings(executor = pool, campus = 'nanhai') {
  const [rows] = await executor.execute(
    `SELECT review_mode, service_status, service_notice, observation_hours, item_pricing_version,
            item_small_campus_price, item_small_off_campus_price,
            item_medium_campus_price, item_medium_off_campus_price,
            item_large_campus_price, item_large_off_campus_price,
            item_urgent_fee, item_door_fee, item_building_9_fee, item_upper_floor_door_fee,
            bundle_tier0_threshold, bundle_tier0_discount,
            bundle_tier1_threshold, bundle_tier1_discount,
            bundle_tier2_threshold, bundle_tier2_discount
       FROM platform_settings WHERE campus = ? LIMIT 1`,
    [campus]
  )
  if (!rows.length) throw new HttpError(503, '平台设置尚未初始化', 'SETTINGS_NOT_INITIALIZED')
  const item = rows[0]
  return {
    reviewMode: Boolean(item.review_mode),
    serviceStatus: item.service_status === 'closed' ? 'closed' : 'open',
    serviceNotice: item.service_notice || '',
    observationHours: observationHours(item.observation_hours),
    itemPricing: {
      version: [2, ITEMIZED_PRICING_CURRENT_VERSION].includes(Number(item.item_pricing_version))
        ? ITEMIZED_PRICING_CURRENT_VERSION : Math.max(1, Math.floor(Number(item.item_pricing_version) || 1)),
      small: { campus: Number(item.item_small_campus_price), off_campus: Number(item.item_small_off_campus_price) },
      medium: { campus: Number(item.item_medium_campus_price), off_campus: Number(item.item_medium_off_campus_price) },
      large: { campus: Number(item.item_large_campus_price), off_campus: Number(item.item_large_off_campus_price) },
      urgentFee: Number(item.item_urgent_fee),
      soonFee: SOON_URGENCY_FEE,
      doorFee: Number(item.item_door_fee),
      building9Fee: Number(item.item_building_9_fee),
      upperFloorDoorFee: Number(item.item_upper_floor_door_fee),
      bundleTiers: [
        { threshold: Number(item.bundle_tier2_threshold), amount: Number(item.bundle_tier2_discount) },
        { threshold: Number(item.bundle_tier1_threshold), amount: Number(item.bundle_tier1_discount) },
        { threshold: Number(item.bundle_tier0_threshold), amount: Number(item.bundle_tier0_discount) }
      ]
    }
  }
}

function readOrderInput(body, campus) {
  const cfg = getCampusConfig(campus)
  const isFree = Boolean(cfg && cfg.roomRule === 'free')
  const urgency = validate.string(body && body.urgency, '送达时限', { min: 1, max: 12 })
  if (!Object.prototype.hasOwnProperty.call(urgencyText, urgency)) throw new HttpError(400, '送达时限无效', 'INVALID_URGENCY')
  const pickupStation = isFree ? validate.oneOf(body && body.pickupStation, '取件驿站', (cfg.stations || []).map(s => s.value)) : null
  const building = isFree ? normalizeShipaiBuilding(body && body.building) : ''
  const room = isFree ? normalizeShipaiRoom(body && body.room) : ''
  if (body && Object.prototype.hasOwnProperty.call(body, 'items')) {
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > MAX_ITEMIZED_ORDER_ITEMS) {
      throw new HttpError(400, `每单应包含1至${MAX_ITEMIZED_ORDER_ITEMS}件快递`, 'INVALID_ORDER_ITEMS')
    }
    if (!['today', 'soon', 'urgent'].includes(urgency)) throw new HttpError(400, '新版订单送达时限无效', 'INVALID_URGENCY')
    const items = body.items.map((item, index) => ({
      index: index + 1,
      scope: validate.oneOf(item && item.scope, `第${index + 1}件取件地点`, ITEM_SCOPES),
      size: validate.oneOf(item && item.size, `第${index + 1}件尺寸`, ITEM_SIZES),
      uploadId: validate.string(item && item.uploadId, `第${index + 1}件图片凭证`, { min: 16, max: 64 })
    }))
    const uploadIds = items.map(item => item.uploadId)
    if (new Set(uploadIds).size !== uploadIds.length) throw new HttpError(400, '每件快递必须使用独立截图', 'DUPLICATE_PICKUP_UPLOAD')
    const scopes = new Set(items.map(item => item.scope))
    const hasPricingVersion = Object.prototype.hasOwnProperty.call(body, 'pricingVersion')
    const pricingVersion = hasPricingVersion
      ? validate.integer(body.pricingVersion, '计价版本', { min: 1, max: 1000 })
      : 1
    const quotedTotal = [2, ITEMIZED_PRICING_CURRENT_VERSION].includes(pricingVersion)
      ? validate.numeric(body.quotedTotal, '前端报价', { min: 0, max: 10000 })
      : null
    if (urgency === 'soon' && pricingVersion !== ITEMIZED_PRICING_CURRENT_VERSION) {
      throw new HttpError(400, '请更新小程序后使用稍急配送', 'INVALID_URGENCY')
    }
    return {
      pricingModel: 'itemized_v1',
      urgency,
      scope: scopes.has('off_campus') ? 'off_campus' : 'campus',
      pieces: items.length,
      isLarge: items.some(item => item.size === 'large'),
      noUpstairs: Boolean(body.noUpstairs),
      note: validate.string(body.note, '备注', { max: 100 }),
      couponId: validate.string(body.couponId, '优惠券', { max: 32 }),
      pricingVersion,
      quotedTotal,
      uploadIds,
      items,
      pickupStation,
      building,
      room
    }
  }
  const scope = validate.oneOf(body && body.scope, '取件地点', ['campus', 'off_campus'])
  const pieces = validate.integer(body && body.pieces, '快递件数', { min: 1, max: MAX_ORDER_PIECES })
  if (urgency === 'soon') throw new HttpError(400, '请更新小程序后使用稍急配送', 'INVALID_URGENCY')
  const uploadIds = Array.isArray(body && body.uploadIds) ? body.uploadIds : []
  if (!uploadIds.length || uploadIds.length > MAX_PICKUP_IMAGES) {
    throw new HttpError(400, `请上传1至${MAX_PICKUP_IMAGES}张取件截图`, 'INVALID_PICKUP_IMAGES')
  }
  return {
    pricingModel: 'legacy',
    urgency, scope, pieces, isLarge: Boolean(body && body.isLarge),
    noUpstairs: Boolean(body && body.noUpstairs),
    note: validate.string(body && body.note, '备注', { max: 100 }),
    couponId: validate.string(body && body.couponId, '优惠券', { max: 32 }),
    uploadIds: [...new Set(uploadIds.map(item => validate.string(item, '图片凭证', { min: 16, max: 64 })))],
    pickupStation,
    building,
    room
  }
}

router.post('/uploads/pickup', authenticateMini, uploadMiddleware, asyncRoute(async (request, response) => {
  const saved = await persistUpload(request.file, request.miniUser.id, 'pickup')
  try {
    // 微信图片内容安全审核
    await imgSecCheck(request.file.buffer)
    await pool.execute(
      `INSERT INTO order_uploads (id, user_id, kind, storage_path, mime_type, file_size, status, created_at, updated_at)
       VALUES (?, ?, 'pickup', ?, ?, ?, 'uploaded', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [saved.id, request.miniUser.id, saved.absolutePath, saved.mime, saved.size]
    )
  } catch (error) {
    await deleteUpload(saved.absolutePath)
    throw error
  }
  return ok(response, { uploadId: saved.id })
}))

router.post('/uploads/delivery', authenticateMini, uploadMiddleware, asyncRoute(async (request, response) => {
  const saved = await persistUpload(request.file, request.miniUser.id, 'delivery')
  try {
    // 微信图片内容安全审核
    await imgSecCheck(request.file.buffer)
    await pool.execute(
      `INSERT INTO order_uploads (id, user_id, kind, storage_path, mime_type, file_size, status, created_at, updated_at)
       VALUES (?, ?, 'delivery', ?, ?, ?, 'uploaded', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [saved.id, request.miniUser.id, saved.absolutePath, saved.mime, saved.size]
    )
  } catch (error) {
    await deleteUpload(saved.absolutePath)
    throw error
  }
  return ok(response, { uploadId: saved.id })
}))

router.post('/orders', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const service = await readServiceStatus()
  if (service.status === 'closed') throw new HttpError(403, '节假日暂停服务，暂不接收订单', 'SERVICE_CLOSED')
  // 每日下单时间窗口：中国时间 07:30–20:00，其余时段（含凌晨）暂停下单。
  // 前端 config/business.js 的 openTime/cutoffHour 必须与此保持一致；这里才是唯一真实约束点。
  const cnNow = new Date(Date.now() + 8 * 60 * 60 * 1000)
  const cnMinutes = cnNow.getUTCHours() * 60 + cnNow.getUTCMinutes()
  if (cnMinutes >= 20 * 60 || cnMinutes < 7 * 60 + 30) throw new HttpError(403, '每日 07:30–20:00 可下单，请稍后再试', 'ORDER_WINDOW_CLOSED')
  const campus = normalizeCampusLenient(request.miniUser.campus)
  const input = readOrderInput(request.body || {}, campus)
  const created = await transaction(async connection => {
    request.miniUser = await lockCampusUser(connection, request.miniUser.id, campus)
    if (!request.miniUser.building || !request.miniUser.room) {
      throw new HttpError(409, '请先完善新校区收货地址', 'PROFILE_ADDRESS_REQUIRED')
    }
    const pricing = input.pricingModel === 'itemized_v1'
      ? await itemizedPricing(
        connection,
        input.items,
        input.urgency,
        input.noUpstairs,
        { building: request.miniUser.building, room: request.miniUser.room },
        input.pricingVersion,
        campus
      )
      : await platformPricing(connection, input.urgency, input.pieces, input.isLarge, input.scope, request.miniUser.building, input.noUpstairs, campus)
    const placeholders = input.uploadIds.map(() => '?').join(',')
    const [uploads] = await connection.execute(
      `SELECT id FROM order_uploads WHERE user_id = ? AND kind = 'pickup' AND status = 'uploaded' AND id IN (${placeholders}) FOR UPDATE`,
      [request.miniUser.id, ...input.uploadIds]
    )
    if (uploads.length !== input.uploadIds.length) throw new HttpError(400, '取件截图已失效，请重新上传', 'PICKUP_UPLOAD_INVALID')
    let discount = 0
    let coupon = null
    if (input.couponId) {
      const [coupons] = await connection.execute(
        `SELECT id, campaign_id, name, amount, min_spend, campus FROM user_coupons
          WHERE id = ? AND user_id = ? AND status = 'available' AND used_order_id IS NULL AND expires_at > UTC_TIMESTAMP()
          LIMIT 1 FOR UPDATE`,
        [input.couponId, request.miniUser.id]
      )
      coupon = coupons[0]
      if (!coupon) throw new HttpError(409, '优惠券不可用，请刷新后重试', 'COUPON_UNAVAILABLE')
      if (coupon.campus && coupon.campus !== campus) throw new HttpError(409, '该优惠券仅限指定校区使用', 'COUPON_CAMPUS_MISMATCH')
      if (pricing.total < Number(coupon.min_spend)) throw new HttpError(409, '未达到优惠券使用门槛', 'COUPON_MIN_SPEND_NOT_MET')
      discount = Math.min(pricing.total, Number(coupon.amount))
    }
    const payableAmount = Number((pricing.total - discount).toFixed(2))
    if (input.pricingModel === 'itemized_v1' && [2, ITEMIZED_PRICING_CURRENT_VERSION].includes(input.pricingVersion)) {
      const quotedCents = Math.round(Number(input.quotedTotal) * 100)
      const payableCents = Math.round(payableAmount * 100)
      if (Math.abs(quotedCents - payableCents) > 1) {
        throw new HttpError(409, '订单价格已更新，请返回下单页刷新后重试', 'PRICE_QUOTE_CHANGED')
      }
    }
    const orderId = createOrderId()
    const deadlineAt = computeDeadlineAt(input.urgency, pricing.closeTime)
    const itemDetailsJson = input.pricingModel === 'itemized_v1' ? JSON.stringify(pricing.items) : null
    await connection.execute(
      `INSERT INTO orders (id, user_id, contact_name, phone, building, room, campus, address, pickup_station, pieces, is_large, urgency, pickup_scope, note, no_upstairs,
         pricing_model, pricing_version, item_details_json, item_subtotal, bundle_discount, urgency_fee, door_fee, building_fee,
         pickup_screenshot_url, original_price, coupon_discount, paid_amount, rider_income, status, deadline_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [orderId, request.miniUser.id, request.miniUser.nickname, request.miniUser.phone, input.building || request.miniUser.building,
        input.room || request.miniUser.room, campus, '', input.pickupStation, input.pieces, input.isLarge ? 1 : 0, input.urgency, input.scope, input.note, input.noUpstairs ? 1 : 0,
        input.pricingModel, Number(pricing.pricingVersion) || 1, itemDetailsJson, Number(pricing.itemSubtotal) || 0, Number(pricing.bundleDiscount) || 0,
        Number(pricing.urgencyFee) || 0, Number(pricing.doorFee) || 0, Number(pricing.buildingFee) || 0, input.uploadIds[0], pricing.total,
        discount, 0, Number((pricing.total * (1 - pricing.commissionRate / 100)).toFixed(2)), payableAmount <= 0 ? 'waiting' : 'unpaid', deadlineAt]
    )
    if (payableAmount <= 0) {
      await queueUrgentOrderAlert(connection, orderId)
      await queueNewOrderRiderEmail(connection, orderId)
    }
    for (const uploadId of input.uploadIds) {
      await connection.execute("UPDATE order_uploads SET status = 'attached', updated_at = UTC_TIMESTAMP() WHERE id = ?", [uploadId])
      await connection.execute("INSERT INTO order_attachments (order_id, upload_id, kind, created_at) VALUES (?, ?, 'pickup', UTC_TIMESTAMP())", [orderId, uploadId])
    }
    if (coupon) {
      const couponFields = payableAmount <= 0
        ? "status = 'used', used_order_id = ?, used_at = UTC_TIMESTAMP()"
        : "used_order_id = ?"
      await connection.execute(
        `UPDATE user_coupons SET ${couponFields}, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [orderId, coupon.id]
      )
    }
    if (coupon && coupon.campaign_id) await connection.execute(
      'UPDATE coupon_campaigns SET used_count = used_count + 1, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [coupon.campaign_id]
    )
    const createdOrder = await findOrder(connection, orderId)
    return mapOrder(createdOrder, { includePrivate: true })
  })
  return sendIdempotent(request, response, { order: created }, 201)
}))

function mapCoupon(item) {
  return {
    id: String(item.id), name: item.name, amount: Number(item.amount), minSpend: Number(item.min_spend),
    status: item.status, expiresAtMs: unixMilliseconds(item.expires_at),
    createdAtMs: unixMilliseconds(item.created_at),
    campaignId: item.campaign_id ? String(item.campaign_id) : ''
  }
}

async function listUserCoupons(executor, userId, campus) {
  const [rows] = await executor.execute(
    `SELECT id, name, amount, min_spend, status, expires_at, created_at, campaign_id
       FROM user_coupons
      WHERE user_id = ? AND (campus IS NULL OR campus = ?)
        AND NOT (status = 'available' AND used_order_id IS NOT NULL)
      ORDER BY status = 'available' DESC, expires_at ASC LIMIT 100`,
    [userId, campus]
  )
  return rows.map(mapCoupon)
}

router.get('/home', authenticateMini, asyncRoute(async (request, response) => {
  await reconcileOrderLifecycle()
  const [orderResult, coupons, settings] = await Promise.all([
    pool.execute(`${orderSelect} WHERE o.user_id = ? ORDER BY o.status = 'unpaid' DESC, o.created_at DESC LIMIT 20`, [request.miniUser.id]),
    listUserCoupons(pool, request.miniUser.id, request.miniUser.campus),
    readMiniSettings(pool, request.miniUser.campus)
  ])
  return ok(response, {
    orders: orderResult[0].map(row => mapOrder(row, { includePrivate: true, includeRiderPhone: true })),
    coupons,
    settings
  })
}))

router.get('/orders', authenticateMini, asyncRoute(async (request, response) => {
  await reconcileOrderLifecycle()
  const [rows] = await pool.execute(`${orderSelect} WHERE o.user_id = ? ORDER BY o.status = 'unpaid' DESC, o.created_at DESC LIMIT 200`, [request.miniUser.id])
  return ok(response, { items: rows.map(row => mapOrder(row, { includePrivate: true, includeRiderPhone: true })) })
}))

router.get('/coupons', authenticateMini, asyncRoute(async (request, response) => {
  return ok(response, { items: await listUserCoupons(pool, request.miniUser.id, request.miniUser.campus) })
}))

router.post('/coupons/redeem', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const code = validate.string(request.body && request.body.code, '兑换码', { min: 4, max: 40 }).toUpperCase()
  const result = await transaction(async connection => {
    const hash = crypto.createHash('sha256').update(code).digest('hex')
    const [rows] = await connection.execute('SELECT * FROM coupon_codes WHERE code_hash = ? LIMIT 1 FOR UPDATE', [hash])
    const item = rows[0]
    if (!item || item.status !== 'available' || new Date(item.expires_at).getTime() <= Date.now()) {
      throw new HttpError(409, '兑换码无效、已使用或已过期', 'COUPON_CODE_UNAVAILABLE')
    }
    // 校区校验：兑换码限定校区（campus 非 NULL）时，必须与用户当前校区一致，否则不可兑换。
    if (item.campus && item.campus !== request.miniUser.campus) {
      throw new HttpError(409, '该兑换码不适用于当前校区', 'COUPON_CODE_CAMPUS_MISMATCH')
    }
    await connection.execute(
      "UPDATE coupon_codes SET status = 'redeemed', redeemed_by = ?, redeemed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?",
      [request.miniUser.id, item.id]
    )
    const [created] = await connection.execute(
      `INSERT INTO user_coupons
         (user_id, campaign_id, name, amount, min_spend, status, campus, expires_at, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, 'available', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [request.miniUser.id, item.name, item.amount, item.min_spend, item.campus || request.miniUser.campus, item.expires_at]
    )
    const [couponRows] = await connection.execute(
      'SELECT id, name, amount, min_spend, status, expires_at FROM user_coupons WHERE id = ?',
      [created.insertId]
    )
    const coupon = couponRows[0]
    return {
      id: String(coupon.id), name: coupon.name, amount: Number(coupon.amount),
      minSpend: Number(coupon.min_spend), status: coupon.status, expiresAtMs: unixMilliseconds(coupon.expires_at)
    }
  })
  return sendIdempotent(request, response, { coupon: result }, 201)
}))

router.post('/rider/applications', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const studentId = validate.string(request.body && request.body.studentId, '学号', { min: 3, max: 40 })
  const rulesVersion = validate.string(request.body && request.body.rulesVersion, '骑手服务规则版本', { min: 1, max: 32 })
  // 真实姓名/性别：申请人自报，审核通过时写入 riders.name_note / riders.gender（客服后续可在管理台修改）
  const realName = validate.string(request.body && request.body.realName, '真实姓名', { min: 2, max: 20 })
  const gender = validate.oneOf(request.body && request.body.gender, '性别', ['male', 'female'])
  // 接单联系电话：申请人自报（申请页预填账号手机号、可改；方案一：只作骑手联系电话，不回写 users.phone，§78 双号码）。
  // 未传时回退账号手机号（旧版客户端兼容）；审核通过时写入 riders.phone。
  const rawPhone = String(request.body && request.body.phone || '').trim()
  const phone = rawPhone ? validate.phone(rawPhone) : request.miniUser.phone
  const result = await transaction(async connection => {
    request.miniUser = await lockCampusUser(connection, request.miniUser.id, request.miniUser.campus)
    const rider = await currentRider(connection, request.miniUser.id)
    if (rider) throw new HttpError(409, '骑手资格已经通过，无需重复申请', 'RIDER_ALREADY_APPROVED')
    const [pendingRows] = await connection.execute(
      "SELECT id FROM rider_applications WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [request.miniUser.id]
    )
    let applicationId
    if (pendingRows.length) {
      applicationId = pendingRows[0].id
      await connection.execute(
        `UPDATE rider_applications
            SET name = ?, student_id = ?, phone = ?, real_name = ?, gender = ?, rules_version = ?, submitted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
          WHERE id = ?`,
        [request.miniUser.nickname, studentId, phone, realName, gender, rulesVersion, applicationId]
      )
    } else {
      const [created] = await connection.execute(
        `INSERT INTO rider_applications
           (user_id, name, student_id, phone, real_name, gender, rules_version, campus, status, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [request.miniUser.id, request.miniUser.nickname, studentId, phone, realName, gender, rulesVersion, normalizeCampusLenient(request.miniUser.campus)]
      )
      applicationId = created.insertId
    }
    return { id: String(applicationId), status: 'pending', statusText: '等待管理员审核' }
  })
  return sendIdempotent(request, response, { application: result }, 201)
}))

async function currentRider(executor, userId, lock = false) {
  const [rows] = await executor.execute(
    `SELECT id, name, phone, status, experience_points, campus, gender
       FROM riders
      WHERE user_id = ? AND status = 'approved'
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [userId]
  )
  return rows[0] || null
}

router.get('/rider/hall', authenticateMini, asyncRoute(async (request, response) => {
  await reconcileOrderLifecycle()
  const rider = await currentRider(pool, request.miniUser.id)
  if (!rider) throw new HttpError(403, '骑手资格未通过审核', 'RIDER_NOT_APPROVED')
  const riderCampus = normalizeCampusLenient(rider.campus)
  const [[count], [rows]] = await Promise.all([
    pool.execute("SELECT COUNT(*) AS total FROM orders WHERE rider_id = ? AND status IN ('accepted','picked','delivering')", [rider.id]),
    // 大厅只显示骑手本校区、已支付（含0元）的 waiting 单；自己发布的/刚转出的单也返回，但会带 blocked 标记由前端置灰。
    // close_time 按订单所属校区取；recently_transferred 用于判定「刚转出的单不能立即接回」。
    pool.execute(
      `SELECT o.*,
          (SELECT close_time FROM platform_settings WHERE campus = o.campus LIMIT 1) AS close_time,
          EXISTS(
            SELECT 1 FROM order_transfers t
             WHERE t.order_id = o.id
               AND t.from_rider_id = ?
               AND t.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${TRANSFER_RECLAIM_BLOCK_HOURS} HOUR)
          ) AS recently_transferred
        FROM orders o
        WHERE o.status = 'waiting'
          AND o.campus = ?
          AND (o.original_price - o.coupon_discount <= 0 OR o.paid_amount > 0)
        ORDER BY o.created_at DESC LIMIT 200`,
      [rider.id, riderCampus]
    )
  ])
  const activeCount = Number(count[0].total) || 0
  const riderCtx = { userId: request.miniUser.id, building: request.miniUser.building, gender: rider.gender }
  return ok(response, {
    activeCount,
    riderProgress: getRiderProgress(rider.experience_points, activeCount),
    // 可接性由后端统一判定（与 accept 一致），blocked 的单由前端置灰展示（含不可接原因），而非隐藏。
    items: rows.map(row => {
      const item = mapOrder(row)
      const grab = evaluateOrderGrab(riderCtx, row)
      item.blocked = grab.blocked
      item.blockReason = grab.reason
      item.blockCode = grab.code
      return item
    })
  })
}))

router.post('/rider/orders/:id/accept', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const service = await readServiceStatus()
  if (service.status === 'closed') throw new HttpError(403, '节假日暂停服务，暂不接单', 'SERVICE_CLOSED')
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const order = await transaction(async connection => {
    request.miniUser = await lockCampusUser(connection, request.miniUser.id, request.miniUser.campus)
    const rider = await currentRider(connection, request.miniUser.id, true)
    if (!rider) throw new HttpError(403, '骑手资格未通过审核', 'RIDER_NOT_APPROVED')
    const [activeRows] = await connection.execute("SELECT COUNT(*) AS total FROM orders WHERE rider_id = ? AND status IN ('accepted','picked','delivering')", [rider.id])
    const activeCount = Number(activeRows[0].total) || 0
    const progress = getRiderProgress(rider.experience_points, activeCount)
    if (activeCount >= progress.maxActiveOrders) {
      throw new HttpError(409, `当前等级最多同时接${progress.maxActiveOrders}单`, 'RIDER_ACTIVE_ORDER_LIMIT')
    }
    const [orders] = await connection.execute(
      `SELECT o.*, EXISTS(
          SELECT 1 FROM order_transfers t
           WHERE t.order_id = o.id
             AND t.from_rider_id = ?
             AND t.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${TRANSFER_RECLAIM_BLOCK_HOURS} HOUR)
        ) AS recently_transferred
        FROM orders o WHERE o.id = ? LIMIT 1 FOR UPDATE`,
      [rider.id, orderId]
    )
    const target = orders[0]
    if (!target || target.status !== 'waiting') throw new HttpError(409, '订单已被其他骑手接走', 'ORDER_UNAVAILABLE')
    if (normalizeCampusLenient(target.campus) !== normalizeCampusLenient(rider.campus)) throw new HttpError(409, '不能接其他校区的订单', 'ORDER_CAMPUS_MISMATCH')
    // 可接性统一判定（与大厅观感同一份规则）：自己发的/刚转出/石牌非本栋/南海异性送上楼/未支付
    const grab = evaluateOrderGrab(
      { userId: request.miniUser.id, building: request.miniUser.building, gender: rider.gender },
      target
    )
    if (grab.blocked) throw new HttpError(409, grab.reason, grab.code)
    await connection.execute("UPDATE orders SET rider_id = ?, status = 'accepted', accepted_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?", [rider.id, orderId])
    await skipUrgentOrderAlert(connection, orderId, 'order_accepted')
    await skipNewOrderRiderEmail(connection, orderId, 'order_accepted')
    return mapOrder(await findOrder(connection, orderId), { includePrivate: true, includeRiderPhone: true })
  })
  return sendIdempotent(request, response, { order })
}))

// 骑手转单：把「已接单、未取件」的单放回接单大厅。前端入口在 packages/order/detail（仅 accepted 态渲染）。
// 为什么只允许 accepted：更晚的状态退回去会踩四个坑——12h 惰性扫描只看 status/delivered_at 不看 rider_id 会立刻
// 翻回 completed；收入按运行时 rider_id 聚合会超发；送达图/取件码会原样泄漏给新骑手；orders 没有 picked_at 列。
// 锁顺序必须是 riders 行 → orders 行 → order_notifications（与 urgent-alert-sweep.js:39 一致），反过来会死锁。
// 刻意不加 SERVICE_CLOSED 判断：节假日停服时，骑手手上已接的单更应该允许交回去。
router.post('/rider/orders/:id/transfer', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const reason = String((request.body && request.body.reason) || '').slice(0, 64)
  const order = await transaction(async connection => {
    const rider = await currentRider(connection, request.miniUser.id, true)
    if (!rider) throw new HttpError(403, '骑手资格未通过审核', 'RIDER_NOT_APPROVED')
    const [countRows] = await connection.execute(
      // 「今日」按中国时间（UTC+8）**自然日**算：先把 UTC 时刻 +8 小时得到北京墙上时间、取日期，再 -8 小时换回 UTC 存值比较。
      // ⚠️ 别写成 DATE_SUB(UTC_DATE(), INTERVAL 8 HOUR)：UTC_DATE() 取的是 UTC 日期，在北京 00:00–08:00 期间
      //    比北京日期小一天，窗口会整整差 24 小时。原写法 '%Y-%m-%d 00:00:00' 更差，是北京 08:00 才重置。
      `SELECT COUNT(*) AS total FROM order_transfers
        WHERE from_rider_id = ? AND created_at >= DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)), INTERVAL 8 HOUR)`,
      [rider.id]
    )
    if (Number(countRows[0].total) >= TRANSFER_DAILY_LIMIT) {
      throw new HttpError(409, '今日转单次数已用完', 'TRANSFER_DAILY_LIMIT')
    }
    const [orders] = await connection.execute('SELECT * FROM orders WHERE id = ? LIMIT 1 FOR UPDATE', [orderId])
    const target = orders[0]
    if (!target) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
    if (String(target.rider_id) !== String(rider.id)) throw new HttpError(403, '这不是你接的订单', 'ORDER_NOT_YOURS')
    if (target.status !== 'accepted') throw new HttpError(409, '只有已接单、未取件的订单才能转单', 'ORDER_NOT_TRANSFERABLE')
    await connection.execute(
      'INSERT INTO order_transfers (order_id, from_rider_id, reason, created_at) VALUES (?, ?, ?, UTC_TIMESTAMP())',
      [orderId, rider.id, reason]
    )
    // rider_id 一置空，原骑手的 maxActiveOrders 名额立刻回收（实时 COUNT(*)），无需额外代码。
    // withhold_rider_income 必须一起清零，否则「惩罚骑手 A」的标记会原样变成「惩罚无辜的骑手 B」。
    await connection.execute(
      "UPDATE orders SET rider_id = NULL, status = 'waiting', accepted_at = NULL, withhold_rider_income = 0, updated_at = UTC_TIMESTAMP() WHERE id = ?",
      [orderId]
    )
    await requeueUrgentOrderAlert(connection, orderId, 'order_transferred_back')
    await requeueNewOrderRiderEmail(connection, orderId, 'order_transferred_back')
    // 不带 includePrivate：骑手已与该单无关，手机号 / 房间号应当立刻消失
    return mapOrder(await findOrder(connection, orderId))
  })
  return sendIdempotent(request, response, { order })
}))

router.get('/rider/tasks', authenticateMini, asyncRoute(async (request, response) => {
  await reconcileOrderLifecycle()
  const rider = await currentRider(pool, request.miniUser.id)
  if (!rider) throw new HttpError(403, '骑手资格未通过审核', 'RIDER_NOT_APPROVED')
  const [[rows], [countRows]] = await Promise.all([
    pool.execute(
      `${orderSelect} WHERE o.rider_id = ? AND o.status IN ('accepted','picked','delivering','delivered') ORDER BY o.accepted_at DESC LIMIT 50`,
      [rider.id]
    ),
    pool.execute("SELECT COUNT(*) AS total FROM orders WHERE rider_id = ? AND status IN ('accepted','picked','delivering')", [rider.id])
  ])
  const activeCount = Number(countRows[0].total) || 0
  return ok(response, {
    items: rows.map(row => mapOrder(row, { includePrivate: true })),
    riderProgress: getRiderProgress(rider.experience_points, activeCount)
  })
}))

router.get('/rider/wallet', authenticateMini, asyncRoute(async (request, response) => {
  await reconcileOrderLifecycle()
  const rider = await currentRider(pool, request.miniUser.id)
  if (!rider) throw new HttpError(403, '骑手资格未通过审核', 'RIDER_NOT_APPROVED')
  const [[riderRows], [withdrawalRows], [incomeRows], [activeRows]] = await Promise.all([
    pool.execute('SELECT available_balance, frozen_balance FROM riders WHERE id = ? LIMIT 1', [rider.id]),
    // 「本月」同理，取北京日期所在月的 1 号 00:00（换回 UTC 存值）。注意 DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-01')
    // 出来的是 UTC 月首，实际是北京 1 号 08:00，不是自然月。
    pool.execute("SELECT COUNT(*) AS total FROM withdrawals WHERE rider_id = ? AND requested_at >= DATE_SUB(DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR), '%Y-%m-01'), INTERVAL 8 HOUR)", [rider.id]),
    pool.execute(
      `SELECT id, rider_income, completed_at, settled_at FROM orders
        WHERE rider_id = ? AND status = 'completed' AND withhold_rider_income = 0 AND withdrawn_at IS NULL ORDER BY completed_at DESC`, [rider.id]
    ),
    pool.execute("SELECT COUNT(*) AS total FROM orders WHERE rider_id = ? AND status IN ('accepted','picked','delivering')", [rider.id])
  ])
  const balance = riderRows[0] || {}
  return ok(response, {
    riderProgress: getRiderProgress(rider.experience_points, Number(activeRows[0].total) || 0),
    balance: {
      available: Number(balance.available_balance) || 0,
      pending: Number(balance.frozen_balance) || 0,
      withdrawLeft: Math.max(0, 5 - (Number(withdrawalRows[0].total) || 0))
    },
    records: incomeRows.map(item => ({
      id: item.id, title: item.settled_at ? '订单收入已入账' : '订单收入观察期中',
      amount: Number(item.rider_income) || 0, type: 'income', dateMs: unixMilliseconds(item.settled_at || item.completed_at),
      settled: Boolean(item.settled_at)
    }))
  })
}))

router.post('/rider/withdrawals', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const result = await transaction(async connection => {
    await reconcileOrderLifecycle(connection)
    const rider = await currentRider(connection, request.miniUser.id)
    if (!rider) throw new HttpError(403, '骑手资格未通过审核', 'RIDER_NOT_APPROVED')
    const [riderRows] = await connection.execute('SELECT available_balance FROM riders WHERE id = ? FOR UPDATE', [rider.id])
    const current = riderRows[0]
    // 全额提现：金额取可提现余额本身，忽略客户端传入值
    const amount = current ? Number(current.available_balance) : 0
    if (amount < 0.01) throw new HttpError(409, '暂无可提现余额', 'WITHDRAWAL_BALANCE_INSUFFICIENT')
    const [countRows] = await connection.execute(
      // 口径必须与上面 /rider/wallet 那条完全一致，否则「还能不能提」与「已提几次」会打架。
      "SELECT COUNT(*) AS total FROM withdrawals WHERE rider_id = ? AND requested_at >= DATE_SUB(DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR), '%Y-%m-01'), INTERVAL 8 HOUR) FOR UPDATE", [rider.id]
    )
    if (Number(countRows[0].total) >= 5) throw new HttpError(409, '本月提现次数已用完', 'WITHDRAWAL_MONTHLY_LIMIT')
    const [created] = await connection.execute(
      "INSERT INTO withdrawals (rider_id, amount, status, requested_at, created_at, updated_at) VALUES (?, ?, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())",
      [rider.id, amount]
    )
    return { id: String(created.insertId), amount, status: 'pending' }
  })
  notifyWithdrawalRequest(result.id)
  return sendIdempotent(request, response, { withdrawal: result }, 201)
}))

router.get('/orders/:id', authenticateMini, asyncRoute(async (request, response) => {
  await reconcileOrderLifecycle()
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const order = await findOrder(pool, orderId)
  if (!order) throw new HttpError(404, '订单不存在或已删除', 'ORDER_NOT_FOUND')
  const userOwnsOrder = hasUserAccess(order, request.miniUser.id)
  const riderOwnsOrder = await hasRiderAccess(pool, order, request.miniUser.id)
  if (!userOwnsOrder && !riderOwnsOrder) throw new HttpError(403, '无权查看该订单', 'ORDER_FORBIDDEN')
  const hideRiderPrivate = riderOwnsOrder && !riderPrivateVisible(order.completed_at, order.observation_hours)
  // 当用户既是下单人又是接单骑手时，在骑手操作状态中优先展示骑手视图
  const riderActive = ['accepted', 'picked', 'delivering'].includes(order.status)
  const role = riderOwnsOrder && (!userOwnsOrder || riderActive) ? 'rider' : 'user'
  return ok(response, {
    role,
    order: mapOrder(order, { includePrivate: role === 'user' || !hideRiderPrivate, includeRiderPhone: role === 'user' })
  })
}))

router.post('/orders/:id/cancel', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const cancelled = await cancelUserOrder(orderId, request.miniUser.id)
  let refund = cancelled.refund
  if (refund && ['pending', 'retryable'].includes(refund.status)) {
    refund = await processRefundByOrderId(orderId)
  }
  const order = await findOrder(pool, orderId)
  return sendIdempotent(request, response, {
    order: mapOrder(order, { includePrivate: true, includeRiderPhone: true }),
    refund
  })
}))

router.post('/orders/:id/confirm-receipt', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const order = await transaction(async connection => {
    const target = await findOrder(connection, orderId, true)
    if (!target || !hasUserAccess(target, request.miniUser.id)) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
    if (target.status !== 'delivered') throw new HttpError(409, '当前订单尚不能确认收货', 'ORDER_CANNOT_CONFIRM')
    const withhold = Boolean(target.withhold_rider_income)
    await connection.execute(
      withhold
        ? "UPDATE orders SET status = 'completed', completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?"
        : "UPDATE orders SET status = 'completed', completed_at = UTC_TIMESTAMP(), income_frozen_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?",
      [orderId]
    )
    if (!withhold && target.rider_id) await connection.execute(
      'UPDATE riders SET frozen_balance = frozen_balance + ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [Number(target.rider_income) || 0, target.rider_id]
    )
    await awardCompletedOrderExperience(connection, orderId)
    return findOrder(connection, orderId)
  })
  return sendIdempotent(request, response, { order: mapOrder(order, { includePrivate: true, includeRiderPhone: true }) })
}))

router.post('/orders/:id/report-missing', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const order = await transaction(async connection => {
    const target = await findOrder(connection, orderId, true)
    if (!target || !hasUserAccess(target, request.miniUser.id)) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
    if (!['delivered', 'completed'].includes(target.status)) throw new HttpError(409, '当前订单不能发起未收到反馈', 'ORDER_CANNOT_REPORT')
    const [existing] = await connection.execute(
      "SELECT id FROM after_sales WHERE order_id = ? AND status IN ('open', 'processing') LIMIT 1 FOR UPDATE",
      [orderId]
    )
    if (!existing.length) {
      const claimId = `AS${crypto.randomBytes(8).toString('hex').toUpperCase()}`
      await connection.execute(
        `INSERT INTO after_sales
           (id, order_id, type, description, item_value, claim_amount, evidence_json, status, created_at, updated_at)
         VALUES (?, ?, 'missing_delivery', '用户反馈未收到快递，等待客服核实。', 0, 0, '[]', 'open', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [claimId, orderId]
      )
    }
    await connection.execute("UPDATE orders SET status = 'disputed', updated_at = UTC_TIMESTAMP() WHERE id = ?", [orderId])
    return findOrder(connection, orderId)
  })
  return sendIdempotent(request, response, { order: mapOrder(order, { includePrivate: true, includeRiderPhone: true }) })
}))

router.post('/rider/orders/:id/status', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const action = validate.oneOf(request.body && request.body.action, '配送操作', ['picked', 'delivering', 'delivered'])
  const deliveryUploadIds = Array.isArray(request.body && request.body.deliveryUploadIds)
    ? [...new Set(request.body.deliveryUploadIds.map(item => validate.string(item, '送达图片', { min: 16, max: 64 })))]
    : []
  if (action === 'delivered' && deliveryUploadIds.length > MAX_DELIVERY_IMAGES) {
    throw new HttpError(400, `送达凭证不超过${MAX_DELIVERY_IMAGES}张`, 'DELIVERY_UPLOAD_TOO_MANY')
  }
  if (action === 'delivered' && deliveryUploadIds.length === 0) {
    throw new HttpError(400, '请先拍摄并上传送达凭证', 'DELIVERY_UPLOAD_REQUIRED')
  }
  const order = await transaction(async connection => {
    const target = await findOrder(connection, orderId, true)
    if (!target) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
    if (!await hasRiderAccess(connection, target, request.miniUser.id)) throw new HttpError(403, '无权操作该订单', 'ORDER_FORBIDDEN')
    const transitions = { accepted: 'picked', picked: 'delivering', delivering: 'delivered' }
    if (transitions[target.status] !== action) throw new HttpError(409, '订单状态已变化，请刷新后重试', 'ORDER_STATUS_CONFLICT')
    if (action === 'delivered') {
      if (deliveryUploadIds.length) {
        const placeholders = deliveryUploadIds.map(() => '?').join(',')
        const [uploads] = await connection.execute(
          `SELECT id FROM order_uploads WHERE user_id = ? AND kind = 'delivery' AND status = 'uploaded' AND id IN (${placeholders}) FOR UPDATE`,
          [request.miniUser.id, ...deliveryUploadIds]
        )
        if (uploads.length !== deliveryUploadIds.length) throw new HttpError(400, '送达图片已失效，请重新上传', 'DELIVERY_UPLOAD_INVALID')
        for (const uploadId of deliveryUploadIds) {
          await connection.execute("UPDATE order_uploads SET status = 'attached', updated_at = UTC_TIMESTAMP() WHERE id = ?", [uploadId])
          await connection.execute("INSERT INTO order_attachments (order_id, upload_id, kind, created_at) VALUES (?, ?, 'delivery', UTC_TIMESTAMP())", [orderId, uploadId])
        }
      }
      await connection.execute(
        "UPDATE orders SET status = 'delivered', delivered_at = UTC_TIMESTAMP(), delivery_photo_url = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?",
        [deliveryUploadIds[0] || '', orderId]
      )
    } else {
      await connection.execute("UPDATE orders SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?", [action, orderId])
    }
    return findOrder(connection, orderId)
  })
  return sendIdempotent(request, response, { order: mapOrder(order, { includePrivate: true }) })
}))

router.get('/orders/:orderId/attachments/:attachmentId', authenticateMini, asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.orderId, '订单编号', { min: 8, max: 32 })
  const attachmentId = validate.string(request.params.attachmentId, '图片凭证', { min: 16, max: 64 })
  const [rows] = await pool.execute(
    `SELECT up.storage_path, up.mime_type, o.user_id, o.rider_id, o.completed_at,
            (SELECT observation_hours FROM platform_settings WHERE id = 1 LIMIT 1) AS observation_hours
       FROM order_attachments oa JOIN order_uploads up ON up.id = oa.upload_id
       JOIN orders o ON o.id = oa.order_id
      WHERE oa.order_id = ? AND oa.upload_id = ? LIMIT 1`,
    [orderId, attachmentId]
  )
  const item = rows[0]
  if (!item) throw new HttpError(404, '图片不存在', 'ORDER_ATTACHMENT_NOT_FOUND')
  let allowed = String(item.user_id) === String(request.miniUser.id)
  if (!allowed && item.rider_id) {
    const rider = await currentRider(pool, request.miniUser.id)
    allowed = Boolean(
      rider &&
      String(rider.id) === String(item.rider_id) &&
      riderPrivateVisible(item.completed_at, item.observation_hours)
    )
  }
  if (!allowed) throw new HttpError(403, '无权查看该图片', 'ORDER_ATTACHMENT_FORBIDDEN')
  // ?size=thumb 时先返回缩略图（详情页显示用，原图几 MB 下载太慢）；失败则退回原图，绝不让图片消失。
  let filePath = item.storage_path
  let contentType = item.mime_type
  if (request.query.size === 'thumb') {
    try {
      filePath = await ensureThumbnail(item.storage_path)
      contentType = 'image/jpeg'
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'thumbnail generation failed', upload_id: attachmentId, error: error.message }))
    }
  }
  response.type(contentType)
  response.setHeader('Cache-Control', 'private, no-store')
  return response.sendFile(filePath, error => {
    if (error && !response.headersSent) response.status(404).end()
  })
}))

// 骑手收新单通知邮箱（可选，留空=不接收）。存 riders.email，供骑手新单邮件 BCC 广播用。
router.post('/rider/email', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const email = String((request.body && request.body.email) || '').trim()
  if (email && (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 128)) {
    throw new HttpError(400, '邮箱格式不正确', 'INVALID_EMAIL')
  }
  const suspicion = email ? emailSuspicion(email) : null
  if (suspicion) {
    throw new HttpError(400, suspicion.reason + '，请改为 ' + suspicion.suggest, 'EMAIL_SUSPICIOUS')
  }
  const result = await transaction(async connection => {
    const rider = await currentRider(connection, request.miniUser.id, true)
    if (!rider) throw new HttpError(403, '骑手资格未通过审核', 'RIDER_NOT_APPROVED')
    await connection.execute('UPDATE riders SET email = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [email || null, rider.id])
    return { riderEmail: email }
  })
  return sendIdempotent(request, response, result)
}))

const campusChangeStatusText = Object.freeze({ pending: '等待审核', approved: '已通过', rejected: '已拒绝' })

router.post('/campus-change-requests', authenticateMini, requireMiniIdempotency, asyncRoute(async (request, response) => {
  const toCampus = validate.oneOf(request.body && request.body.toCampus, '目标校区', CAMPUSES)
  const reason = validate.string(request.body && request.body.reason, '申请原因', { max: 300 })
  const result = await transaction(async connection => {
    const changed = await autoChangeCampus(connection, request.miniUser.id, toCampus, reason, request.miniUser.campus)
    await writeAudit(connection, request, 'campus_change_auto_approved', 'campus_change_request', changed.id, {
      userId: String(request.miniUser.id), ...changed, reason
    })
    return { request: changed, user: mapUser(await findUserById(connection, request.miniUser.id)) }
  })
  return sendIdempotent(request, response, result, 201)
}))

router.get('/campus-change-requests', authenticateMini, asyncRoute(async (request, response) => {
  const [rows] = await pool.execute(
    `SELECT id, from_campus, to_campus, reason, status, review_reason, submitted_at, reviewed_at
       FROM campus_change_requests
      WHERE user_id = ?
      ORDER BY submitted_at DESC LIMIT 50`,
    [request.miniUser.id]
  )
  return ok(response, {
    items: rows.map(item => ({
      id: String(item.id),
      fromCampus: item.from_campus,
      toCampus: item.to_campus,
      reason: item.reason,
      status: item.status,
      statusText: campusChangeStatusText[item.status] || item.status,
      reviewReason: item.review_reason || '',
      submittedAtMs: unixMilliseconds(item.submitted_at),
      reviewedAtMs: unixMilliseconds(item.reviewed_at)
    }))
  })
}))

module.exports = router
module.exports.awardCompletedOrderExperience = awardCompletedOrderExperience
