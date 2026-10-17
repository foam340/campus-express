const crypto = require('crypto')
const express = require('express')
const fs = require('fs/promises')
const { pool, transaction } = require('../db')
const { authenticateAdmin, requireRoles } = require('../auth')
const { writeAudit } = require('../audit')
const { lockCampusUser, applyCampusChange } = require('../campus-change')
const { requireIdempotency, sendIdempotent } = require('../idempotency')
const { asyncRoute, HttpError, ok } = require('../http')
const validate = require('../validation')
const { formatDormBuilding } = require('../business-rules')
const { getRiderProgress } = require('../rider-level')
const config = require('../config')
const { attachmentDownloadName, resolveAttachmentPath } = require('../admin-attachments')
const { cancelLockedOrder, processRefundByOrderId } = require('../payment-refunds')
const { awardCompletedOrderExperience } = require('./mini')
const { sendRiderWithdrawalEmail } = require('../urgent-email')
const { buildWithdrawalEmail } = require('../rider-notify')
const { isKnownCampus, DEFAULT_CAMPUS, normalizeCampusLenient, stationLabel, CAMPUS_CONFIG } = require('../campus-config')

const router = express.Router()
const orderStatuses = ['unpaid', 'waiting', 'accepted', 'picked', 'delivering', 'delivered', 'completed', 'cancelled', 'disputed']
const statusLabels = {
  unpaid: '待支付', waiting: '待接单', accepted: '已接单', picked: '已取件', delivering: '配送中',
  delivered: '待确认', completed: '已完成', cancelled: '已取消', disputed: '售后中',
  pending: '等待审核', approved: '审核通过', rejected: '审核未通过', suspended: '已暂停'
}
const urgencyLabels = { urgent: '很急', today: '今天', tomorrow: '明天' }
const pickupScopeLabels = { campus: '校内', off_campus: '校外' }
const DORM_BUILDING_GENDER = CAMPUS_CONFIG.nanhai.buildingGender
const BUILDING_GENDER_TEXT = { male: '男', female: '女', mixed: '混宿' }

// 「净收入明细」页手工记账的预设类别。key 落库；direction 是类别固有方向，
// **由服务端推导、不接受客户端传参**——否则会出现「骑手补贴」被记成收入这类自相矛盾的账，
// 事后没人能从数据里分辨那是手滑还是真有这么一笔。
// 自定义类别走 key='custom'，文字存 category 列，此时才由客户端指定方向。
const LEDGER_CATEGORIES = [
  { key: 'rider_subsidy', label: '骑手补贴', direction: 'expense' },
  { key: 'flyer', label: '传单印刷', direction: 'expense' },
  { key: 'material', label: '物料采购', direction: 'expense' },
  { key: 'promotion', label: '推广投放', direction: 'expense' },
  { key: 'equipment', label: '设备耗材', direction: 'expense' },
  { key: 'other_expense', label: '其他支出', direction: 'expense' },
  { key: 'other_income', label: '其他收入', direction: 'income' }
]
const LEDGER_CUSTOM_CATEGORY = 'custom'
const LEDGER_CATEGORY_LABELS = Object.assign(
  { [LEDGER_CUSTOM_CATEGORY]: '自定义' },
  ...LEDGER_CATEGORIES.map(item => ({ [item.key]: item.label }))
)
const LEDGER_DIRECTION_LABELS = { income: '收入', expense: '支出' }

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

router.use(authenticateAdmin)

function mysqlTimestamp(alias) {
  // 数据库统一以 UTC 存储，管理台显示北京时间（UTC+8）；会话时区是系统本地时区，
  // 直接 UNIX_TIMESTAMP 会错 8 小时，必须先显式转成 +08:00 再取时间戳。
  return `CAST(UNIX_TIMESTAMP(CONVERT_TZ(${alias}, '+00:00', '+08:00')) * 1000 AS UNSIGNED)`
}

// 「中国时间（UTC+8）今天 00:00」在 UTC 存值上的表示。created_at 等时间列都存 UTC，
// 故先 +8 小时拿到北京墙上时间、取日期，再 -8 小时换回 UTC 才能与列比较。
// ⚠️ 别写成 DATE_SUB(UTC_DATE(), INTERVAL 8 HOUR)：UTC_DATE() 取的是 **UTC 日期**，在北京
//    00:00–08:00 期间比北京日期小一天，窗口会整整差 24 小时（「今日」会显示成前一天的数据）。
const CN_DAY_START = "DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)), INTERVAL 8 HOUR)"

// 管理台校区解析（§4）：账号锁定校区的强制回本校区、忽略 ?campus=（防越权看另一校区）；
// 老板（admin_users.campus=NULL）用 ?campus= 切换，缺省 nanhai。白名单只认 nanhai|shipai，其余回落 nanhai。
function resolveAdminCampus(request) {
  const accountCampus = request.admin && request.admin.campus
  if (isKnownCampus(accountCampus)) return accountCampus
  // 老板（campus=NULL）用 ?campus= 切换；POST 请求前端也把 campus 放 query，
  // 这里同时兜底读 body.campus，避免「在石牌面板记一笔账却落到南海」这类错校区。
  const raw = (request.query && request.query.campus) || (request.body && request.body.campus)
  // 白名单只认已配置校区，其余回落默认（第一项）；对现有两校区行为不变。
  return isKnownCampus(raw) ? raw : DEFAULT_CAMPUS
}

function mapOrder(row) {
  const building = formatDormBuilding(row.building, row.campus)
  const campusCfg = CAMPUS_CONFIG[row.campus]
  const gender = buildingGender(building, row.room, campusCfg && campusCfg.buildingGender)
  let itemDetails = []
  try {
    const parsed = typeof row.item_details_json === 'string' ? JSON.parse(row.item_details_json) : row.item_details_json
    if (Array.isArray(parsed)) itemDetails = parsed
  } catch (error) {}
  const itemScopes = [...new Set(itemDetails.map(item => item && item.scope).filter(scope => pickupScopeLabels[scope]))]
  const pickupScope = itemScopes.length > 1 ? 'mixed' : (itemScopes[0] || row.pickup_scope || '')
  return {
    id: row.id,
    campus: normalizeCampusLenient(row.campus),
    contactName: row.contact_name || '',
    phone: row.phone || '',
    address: row.address || '',
    building,
    buildingGender: gender,
    buildingGenderText: BUILDING_GENDER_TEXT[gender] || '',
    room: row.room || '',
    pieces: Number(row.pieces) || 1,
    isLarge: Boolean(row.is_large),
    noUpstairs: Boolean(row.no_upstairs),
    urgency: row.urgency || '',
    urgencyText: urgencyLabels[row.urgency] || row.urgency || '',
    pickupScope,
    pickupScopeText: pickupScope === 'mixed' ? '校内+校外' : (pickupScopeLabels[pickupScope] || ''),
    pickupStation: row.pickup_station || '',
    pickupStationText: stationLabel(row.campus, row.pickup_station),
    pricingModel: row.pricing_model || 'legacy',
    itemDetails,
    itemSubtotal: Number(row.item_subtotal) || 0,
    bundleDiscount: Number(row.bundle_discount) || 0,
    urgencyFee: Number(row.urgency_fee) || 0,
    doorFee: Number(row.door_fee) || 0,
    buildingFee: Number(row.building_fee) || 0,
    pricingVersion: Math.max(1, Math.floor(Number(row.pricing_version) || 1)),
    deadlineAtMs: Number(row.deadline_at_ms) || 0,
    riderName: row.rider_name || '',
    riderPhone: row.rider_phone || '',
    riderId: Number(row.rider_id) || 0,
    riderIncome: Number(row.rider_income) || 0,
    withholdRiderIncome: Boolean(row.withhold_rider_income),
    riderPayoutPending: Boolean(row.rider_id) && row.status !== 'cancelled' && !row.income_frozen_at && !row.settled_at,
    originalPrice: Number(row.original_price) || 0,
    paidAmount: Number(row.paid_amount) || 0,
    refundAmount: Number(row.refund_amount) || 0,
    refundStatus: row.refund_status || '',
    refundLastError: row.refund_last_error || '',
    attachmentCount: Number(row.attachment_count) || 0,
    status: row.status || 'waiting',
    statusText: statusLabels[row.status] || row.status || '',
    createdAtMs: Number(row.created_at_ms) || 0
  }
}

async function readSettings(executor = pool, campus = 'nanhai') {
  const [rows] = await executor.execute(
    'SELECT * FROM platform_settings WHERE campus = ? LIMIT 1',
    [campus]
  )
  if (!rows[0]) throw new HttpError(503, '平台设置尚未初始化', 'SETTINGS_NOT_INITIALIZED')
  const item = rows[0]
  return {
    campusPrice: Number(item.campus_price),
    offCampusPrice: Number(item.off_campus_price),
    campusUrgentPrice: Number(item.campus_urgent_price),
    offCampusUrgentPrice: Number(item.off_campus_urgent_price),
    extraPiecePrice: Number(item.extra_piece_price),
    largePrice: Number(item.large_price),
    itemSmallCampusPrice: Number(item.item_small_campus_price),
    itemSmallOffCampusPrice: Number(item.item_small_off_campus_price),
    itemMediumCampusPrice: Number(item.item_medium_campus_price),
    itemMediumOffCampusPrice: Number(item.item_medium_off_campus_price),
    itemLargeCampusPrice: Number(item.item_large_campus_price),
    itemLargeOffCampusPrice: Number(item.item_large_off_campus_price),
    itemPricingVersion: Math.max(1, Math.floor(Number(item.item_pricing_version) || 1)),
    itemUrgentFee: Number(item.item_urgent_fee),
    itemDoorFee: Number(item.item_door_fee),
    itemBuilding9Fee: Number(item.item_building_9_fee),
    itemUpperFloorDoorFee: Number(item.item_upper_floor_door_fee),
    bundleTier0Threshold: Number(item.bundle_tier0_threshold),
    bundleTier0Discount: Number(item.bundle_tier0_discount),
    bundleTier1Threshold: Number(item.bundle_tier1_threshold),
    bundleTier1Discount: Number(item.bundle_tier1_discount),
    bundleTier2Threshold: Number(item.bundle_tier2_threshold),
    bundleTier2Discount: Number(item.bundle_tier2_discount),
    autoConfirmHours: Number(item.auto_confirm_hours),
    observationHours: Number(item.observation_hours),
    claimLimit: Number(item.claim_limit),
    commissionRate: Number(item.commission_rate),
    serviceStatus: item.service_status || 'open',
    serviceNotice: item.service_notice || '',
    // 管理台「平台设置」要显示审核模式当前状态，故带出。PUT /settings 的字段白名单不含 review_mode，
    // 保存业务参数不会误改它——两者互相独立，只能走 POST /settings/review-mode。
    reviewMode: Boolean(item.review_mode)
  }
}

router.get('/dashboard', requireRoles('operator', 'customer_service', 'finance', 'auditor'), asyncRoute(async (request, response) => {
  const campus = resolveAdminCampus(request)
  const [[statsRows], [recentRows]] = await Promise.all([
    pool.query(
      // 今日统计按中国时间（UTC+8）0:00–23:59 起算：下限见 CN_DAY_START，上限 = 下限 + 1 天。
      // 全部子查询按 campus 过滤；10 个子查询各占一个 ?，统一传同一个 campus 值。
      // 第 4 个子查询是「今日额外收支」：今日净收入 = 订单口径净收入 + 该值（见 stats.todayNetRevenue）。
      `SELECT
         (SELECT COUNT(*) FROM orders WHERE campus = ? AND created_at >= ${CN_DAY_START} AND created_at < DATE_ADD(${CN_DAY_START}, INTERVAL 1 DAY) AND status NOT IN ('unpaid', 'cancelled')) AS today_orders,
         (SELECT COALESCE(SUM(paid_amount), 0) FROM orders WHERE campus = ? AND created_at >= ${CN_DAY_START} AND created_at < DATE_ADD(${CN_DAY_START}, INTERVAL 1 DAY) AND status NOT IN ('unpaid', 'cancelled')) AS today_revenue,
         (SELECT COALESCE(SUM(paid_amount) - SUM(IF(withhold_rider_income = 1, 0, rider_income)), 0) FROM orders WHERE campus = ? AND created_at >= ${CN_DAY_START} AND created_at < DATE_ADD(${CN_DAY_START}, INTERVAL 1 DAY) AND status NOT IN ('unpaid', 'cancelled')) AS today_net_revenue,
         (SELECT COALESCE(SUM(IF(direction = 'income', amount, -amount)), 0) FROM ledger_entries WHERE campus = ? AND entry_date = DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))) AS today_ledger_adjustment,
         (SELECT COUNT(*) FROM orders WHERE campus = ? AND status = 'waiting') AS waiting,
         (SELECT COUNT(*) FROM orders WHERE campus = ? AND status IN ('accepted','picked','delivering','delivered')) AS running,
         (SELECT COUNT(*) FROM after_sales a JOIN orders o ON o.id = a.order_id WHERE o.campus = ? AND a.status IN ('open','processing')) AS after_sales,
         (SELECT COUNT(*) FROM rider_applications WHERE campus = ? AND status = 'pending') AS pending_riders,
         (SELECT COUNT(*) FROM withdrawals w JOIN riders r ON r.id = w.rider_id WHERE r.campus = ? AND w.status = 'pending') AS pending_withdrawals,
         (SELECT COUNT(*) FROM order_refunds rf JOIN orders o ON o.id = rf.order_id WHERE o.campus = ? AND rf.status IN ('retryable','manual_review')) AS refund_attention`,
      [campus, campus, campus, campus, campus, campus, campus, campus, campus, campus]
    ),
    pool.query(
      `SELECT o.id, o.contact_name, o.phone, o.building, o.room, o.pieces, o.is_large, o.no_upstairs,
               o.urgency, o.pickup_scope, o.campus, o.address, o.pickup_station, o.pricing_model, o.pricing_version, o.item_details_json, o.item_subtotal,
               o.bundle_discount, o.urgency_fee, o.door_fee, o.building_fee, o.original_price, o.paid_amount, o.status,
               o.rider_id, o.rider_income, o.income_frozen_at, o.settled_at, o.withhold_rider_income,
               refund.amount AS refund_amount, refund.status AS refund_status, refund.last_error AS refund_last_error,
               (SELECT COUNT(*) FROM order_attachments oa_count WHERE oa_count.order_id = o.id) AS attachment_count,
               COALESCE(NULLIF(r.name_note,''), r.name) AS rider_name, r.phone AS rider_phone, ${mysqlTimestamp('o.created_at')} AS created_at_ms, ${mysqlTimestamp('o.deadline_at')} AS deadline_at_ms
         FROM orders o
         LEFT JOIN riders r ON r.id = o.rider_id
         LEFT JOIN order_refunds refund ON refund.order_id = o.id
        WHERE o.campus = ?
        ORDER BY o.created_at DESC
        LIMIT 6`,
      [campus]
    )
  ])
  const row = statsRows[0] || {}
  return ok(response, {
    stats: {
      todayOrders: Number(row.today_orders) || 0,
      todayRevenue: Number(row.today_revenue) || 0,
      // 今日净收入 = 订单口径净收入 + 今日额外收支（手工账），实时现查，不缓存。
      todayNetRevenue: Number(((Number(row.today_net_revenue) || 0) + (Number(row.today_ledger_adjustment) || 0)).toFixed(2)),
      waiting: Number(row.waiting) || 0,
      running: Number(row.running) || 0,
      afterSales: Number(row.after_sales) || 0,
      pendingRiders: Number(row.pending_riders) || 0,
      pendingWithdrawals: Number(row.pending_withdrawals) || 0,
      refundAttention: Number(row.refund_attention) || 0
    },
    recentOrders: recentRows.map(mapOrder)
  })
}))

router.get('/dashboard/trend', requireRoles('operator', 'customer_service', 'finance', 'auditor'), asyncRoute(async (request, response) => {
  const campus = resolveAdminCampus(request)
  const [rows] = await pool.query(
    `SELECT
       DATE_FORMAT(CONVERT_TZ(o.created_at, '+00:00', '+08:00'), '%Y-%m-%d') AS day,
       COUNT(*) AS orders,
       COALESCE(SUM(o.paid_amount), 0) AS revenue,
       COALESCE(SUM(o.paid_amount) - SUM(IF(o.withhold_rider_income = 1, 0, o.rider_income)), 0) AS net_revenue
     FROM orders o
     WHERE o.created_at >= DATE_SUB(${CN_DAY_START}, INTERVAL 14 DAY)
       AND o.status NOT IN ('unpaid', 'cancelled')
       AND o.campus = ?
     GROUP BY day
     ORDER BY day ASC`,
    [campus]
  )
  const byDay = new Map(rows.map(row => [String(row.day), {
    orders: Number(row.orders) || 0,
    revenue: Number(row.revenue) || 0,
    netRevenue: Number(row.net_revenue) || 0
  }]))
  // 生成最近 14 个北京自然日（含今天），无订单的日期补 0，保证折线图横轴连续
  const base = new Date(Date.now() + 8 * 3600 * 1000) // +8h 后按 UTC 取 YYYY-MM-DD = 北京今日
  const days = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(base.getTime())
    d.setUTCDate(d.getUTCDate() - i)
    const date = d.toISOString().slice(0, 10)
    const hit = byDay.get(date) || { orders: 0, revenue: 0, netRevenue: 0 }
    days.push({ date, orders: hit.orders, revenue: hit.revenue, netRevenue: hit.netRevenue })
  }
  return ok(response, { days })
}))

function ledgerCategoryLabel(category) {
  return LEDGER_CATEGORY_LABELS[category] || String(category || '')
}

// 金额统一收敛到分再落库 / 写审计：validate.numeric 只保证是有限数，
// 像 1.005 这样的值直接交给 DECIMAL(10,2) 会被 MySQL 四舍五入，导致审计里记的数和库里存的钱对不上。
function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100
}

// 日期键归一化。SQL 侧已经 DATE_FORMAT 出字符串了，这里只是兜底：
// mysql2 在 timezone:'Z' 下会把 DATE 列返回成 JS Date 对象（String() 出来是
// "Mon Sep 21 2026 08:00:00 GMT+0800" 这种），一旦它混进 Map 键，同一天会裂成两条、合计凭空翻倍。
function normalizeDayKey(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  const text = String(value == null ? '' : value).trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ''
}

// 记账日期必须是真实存在的北京自然日。
// 只用 /^\d{4}-\d{2}-\d{2}$/ 会放过 2026-02-31 和 0000-01-01，这两个 MySQL 严格模式都会拒绝，
// 表现成 500 而不是 400。故用 Date.UTC 回环比对，并限定年份区间。
// 上限取「北京今天」：记账记的是已经发生的收支，不允许记到未来。
// ⚠️ 这里全程用字符串，不接受 Date 对象——北京时间清晨 new Date() 的 UTC 日期是前一天，
//    用它算日期会让整笔账偏一天。
function ledgerEntryDate(value) {
  const text = validate.string(value, '记账日期', { min: 10, max: 10 })
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!matched) throw new HttpError(400, '记账日期格式应为 YYYY-MM-DD', 'INVALID_LEDGER_DATE')
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new HttpError(400, '记账日期不是有效日期', 'INVALID_LEDGER_DATE')
  }
  if (year < 2020 || year > 2100) throw new HttpError(400, '记账日期超出可记账范围', 'INVALID_LEDGER_DATE')
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  if (text > today) throw new HttpError(400, `记账日期不能晚于今天（${today}）`, 'INVALID_LEDGER_DATE')
  return text
}

// 记账入参解析：新增和编辑共用，避免两处校验各写一遍之后逐渐漂移。
function readLedgerEntryInput(body) {
  const source = body || {}
  const entryDate = ledgerEntryDate(source.entryDate)
  const rawCategory = validate.string(source.category, '收支类别', { min: 1, max: 32 })
  const preset = LEDGER_CATEGORIES.find(item => item.key === rawCategory)
  let category = rawCategory
  let direction = ''
  if (preset) {
    direction = preset.direction
  } else if (rawCategory === LEDGER_CUSTOM_CATEGORY) {
    category = validate.string(source.customCategory, '自定义类别名称', { min: 1, max: 32 })
    direction = validate.oneOf(source.direction, '收支方向', ['income', 'expense'])
  } else {
    throw new HttpError(400, '收支类别无效', 'INVALID_LEDGER_CATEGORY')
  }
  // ⚠️ validate.numeric 不是金额守卫：null / '' / '  ' / [] / true 都会被 Number() 变成 0
  //    并顺利通过 { min: 0 }，把一笔真实支出静默记成 ¥0.00；'1e21' 能过校验但会被 MySQL
  //    严格模式拒掉，表现成 500。所以下限写死 0.01，上限对齐 DECIMAL(10,2) 的容量。
  const amount = roundMoney(validate.numeric(source.amount, '金额', { min: 0.01, max: 99999999.99 }))
  if (!(amount >= 0.01)) throw new HttpError(400, '金额必须大于 0', 'INVALID_LEDGER_AMOUNT')
  const note = validate.string(source.note, '备注', { min: 0, max: 200 })
  return { entryDate, category, direction, amount, note }
}

// 账目编号走严格白名单：validate.integer 会放过 '1e3' 和 '0x10'（Number() 的副作用），
// 参数化查询虽然不会注入，但会把不存在的编号当成合法输入去查，错误变成 404 而不是 400。
function ledgerEntryId(value) {
  const text = String(value == null ? '' : value).trim()
  if (!/^[1-9]\d{0,18}$/.test(text)) throw new HttpError(400, '账目编号无效', 'INVALID_LEDGER_ID')
  return text
}

const LEDGER_ENTRY_SELECT = `SELECT e.id, e.campus, DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date_text,
         e.direction, e.category, e.amount, e.note,
         e.created_by, creator.display_name AS created_by_name, updater.display_name AS updated_by_name,
         ${mysqlTimestamp('e.created_at')} AS created_at_ms, ${mysqlTimestamp('e.updated_at')} AS updated_at_ms
    FROM ledger_entries e
    LEFT JOIN admin_users creator ON creator.id = e.created_by
    LEFT JOIN admin_users updater ON updater.id = e.updated_by`

function mapLedgerEntry(row) {
  return {
    id: String(row.id),
    campus: normalizeCampusLenient(row.campus),
    entryDate: String(row.entry_date_text || ''),
    direction: row.direction,
    directionText: LEDGER_DIRECTION_LABELS[row.direction] || String(row.direction || ''),
    category: row.category,
    categoryText: ledgerCategoryLabel(row.category),
    amount: Number(row.amount) || 0,
    note: row.note || '',
    createdByName: row.created_by_name || '',
    updatedByName: row.updated_by_name || '',
    createdAtMs: Number(row.created_at_ms) || 0,
    updatedAtMs: Number(row.updated_at_ms) || 0
  }
}

// 每日净收入明细：列出「产生过订单」或「记过账」的北京自然日 + 合计。
// 净收入（订单口径，与 /dashboard/trend 完全一致）= SUM(paid_amount) − SUM(骑手收入)
//   ≡ 平台抽成利润 − 优惠券损失（因为 paid_amount = original_price − coupon_discount；
//     抽成利润 = original_price − rider_income）。这一列不掺任何手工账目，保持不变。
// 实际净收入 = 净收入 + 额外收支（手工登记的订单外收入与支出）。
// 与 trend 的区别：不限定 14 天、不补空日，按日期倒序。
router.get('/dashboard/income', requireRoles('operator', 'customer_service', 'finance', 'auditor'), asyncRoute(async (request, response) => {
  const campus = resolveAdminCampus(request)
  const [[rows], [ledgerRows]] = await Promise.all([
    pool.query(
      `SELECT
         DATE_FORMAT(CONVERT_TZ(o.created_at, '+00:00', '+08:00'), '%Y-%m-%d') AS day,
         COUNT(*) AS orders,
         COALESCE(SUM(o.paid_amount), 0) AS revenue,
         COALESCE(SUM(o.paid_amount) - SUM(IF(o.withhold_rider_income = 1, 0, o.rider_income)), 0) AS net_revenue,
         COALESCE(SUM(o.coupon_discount), 0) AS coupon_loss
       FROM orders o
       WHERE o.status NOT IN ('unpaid', 'cancelled')
         AND o.campus = ?
       GROUP BY day
       ORDER BY day DESC`,
      [campus]
    ),
    // 与订单侧一样不加时间过滤：订单侧是全时段无界的，账目侧若只取近 N 天，就成了
    // 「拿全时段的分母去加一段时间的加数」，合计必然对不上。要么都过滤，要么都不过滤。
    // ⚠️ 聚合查询绝不能加 LIMIT：那会让合计静默漏账（钱包明细写死 LIMIT 20 就是这么出的事）。
    pool.query(
      `SELECT DATE_FORMAT(l.entry_date, '%Y-%m-%d') AS day,
              COALESCE(SUM(IF(l.direction = 'income', l.amount, 0)), 0) AS extra_income,
              COALESCE(SUM(IF(l.direction = 'expense', l.amount, 0)), 0) AS extra_expense
         FROM ledger_entries l
        WHERE l.campus = ?
        GROUP BY day`,
      [campus]
    )
  ])

  const orderRowByDay = new Map()
  rows.forEach(row => {
    const day = normalizeDayKey(row.day)
    if (!day) return
    orderRowByDay.set(day, {
      orders: Number(row.orders) || 0,
      revenue: Number(row.revenue) || 0,
      netRevenue: Number(row.net_revenue) || 0,
      couponLoss: Number(row.coupon_loss) || 0
    })
  })
  const ledgerByDay = new Map()
  ledgerRows.forEach(row => {
    const day = normalizeDayKey(row.day)
    if (!day) return
    ledgerByDay.set(day, {
      extraIncome: Number(row.extra_income) || 0,
      extraExpense: Number(row.extra_expense) || 0
    })
  })

  // 订单日是「有订单的日子」，账目日是「记过账的日子」，两个集合互相都可能缺席
  // （例如当天没单、只发了一笔骑手补贴），所以必须取并集，不能只遍历订单日。
  const dayKeys = new Set(orderRowByDay.keys())
  ledgerByDay.forEach((value, day) => dayKeys.add(day))

  // 显式按 ISO 字符串倒序：跨天稳定，且不依赖 SQL 的排序结果在 JS 合并后仍然成立。
  const days = [...dayKeys].sort((left, right) => (left < right ? 1 : left > right ? -1 : 0)).map(day => {
    const orderRow = orderRowByDay.get(day)
    const ledger = ledgerByDay.get(day) || { extraIncome: 0, extraExpense: 0 }
    const extraIncome = Number(ledger.extraIncome.toFixed(2))
    const extraExpense = Number(ledger.extraExpense.toFixed(2))
    const adjustment = Number((extraIncome - extraExpense).toFixed(2))
    const netRevenue = orderRow ? orderRow.netRevenue : 0
    return {
      date: day,
      orders: orderRow ? orderRow.orders : 0,
      revenue: orderRow ? orderRow.revenue : 0,
      netRevenue,
      couponLoss: orderRow ? orderRow.couponLoss : 0,
      extraIncome,
      extraExpense,
      adjustment,
      actualNetRevenue: Number((netRevenue + adjustment).toFixed(2))
    }
  })

  const total = days.reduce((sum, day) => ({
    orders: sum.orders + day.orders,
    revenue: sum.revenue + day.revenue,
    netRevenue: sum.netRevenue + day.netRevenue,
    couponLoss: sum.couponLoss + day.couponLoss,
    extraIncome: sum.extraIncome + day.extraIncome,
    extraExpense: sum.extraExpense + day.extraExpense
  }), { orders: 0, revenue: 0, netRevenue: 0, couponLoss: 0, extraIncome: 0, extraExpense: 0 })
  // 逐日累加会引入浮点尾差，合计统一收敛到分
  const roundedTotalFields = ['revenue', 'netRevenue', 'couponLoss', 'extraIncome', 'extraExpense']
  roundedTotalFields.forEach(key => { total[key] = Number(total[key].toFixed(2)) })
  // 两个派生合计由已收敛的分项算出来，保证表尾的加减法和逐行相加的结果一致
  total.adjustment = Number((total.extraIncome - total.extraExpense).toFixed(2))
  total.actualNetRevenue = Number((total.netRevenue + total.adjustment).toFixed(2))

  return ok(response, {
    days,
    total,
    dayCount: days.length,
    categories: LEDGER_CATEGORIES,
    customCategoryKey: LEDGER_CUSTOM_CATEGORY
  })
}))

// 额外收支明细。读取权限与 GET /dashboard/income 一致——能看这个页面的角色都能看账目；
// 写入（新增/编辑/删除）收紧到 operator + customer_service，前端按同样规则做按钮门禁。
router.get('/ledger-entries', requireRoles('operator', 'customer_service', 'finance', 'auditor'), asyncRoute(async (request, response) => {
  const page = validate.integer(request.query.page || 1, '页码', { min: 1, max: 100000 })
  const pageSize = validate.integer(request.query.pageSize || 20, '每页数量', { min: 1, max: 100 })
  const offset = (page - 1) * pageSize
  const campus = resolveAdminCampus(request)
  const [[items], [countRows]] = await Promise.all([
    // ⚠️ id 这个次序键是必需的：只按 entry_date 排序时，同一天的多条记录顺序由 MySQL 决定，
    //    LIMIT/OFFSET 翻页会静默跳行或重复。
    pool.query(`${LEDGER_ENTRY_SELECT} WHERE e.campus = ? ORDER BY e.entry_date DESC, e.id DESC LIMIT ? OFFSET ?`, [campus, pageSize, offset]),
    pool.query('SELECT COUNT(*) AS total FROM ledger_entries WHERE campus = ?', [campus])
  ])
  return ok(response, {
    items: items.map(mapLedgerEntry),
    total: Number(countRows[0].total) || 0,
    page,
    pageSize,
    categories: LEDGER_CATEGORIES,
    customCategoryKey: LEDGER_CUSTOM_CATEGORY
  })
}))

router.post('/ledger-entries', requireRoles('operator', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const input = readLedgerEntryInput(request.body)
  const campus = resolveAdminCampus(request)
  const createdId = await transaction(async connection => {
    const [result] = await connection.execute(
      `INSERT INTO ledger_entries
         (campus, entry_date, direction, category, amount, note, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [campus, input.entryDate, input.direction, input.category, input.amount, input.note, request.admin.id, request.admin.id]
    )
    const id = String(result.insertId)
    await writeAudit(connection, request, 'ledger_entry_created', 'ledger_entry', id, {
      campus,
      entryDate: input.entryDate,
      direction: input.direction,
      category: input.category,
      categoryText: ledgerCategoryLabel(input.category),
      amount: input.amount,
      note: input.note
    })
    return id
  })
  const [rows] = await pool.query(`${LEDGER_ENTRY_SELECT} WHERE e.id = ? LIMIT 1`, [createdId])
  return sendIdempotent(request, response, { item: rows[0] ? mapLedgerEntry(rows[0]) : null })
}))

router.post('/ledger-entries/:id/update', requireRoles('operator', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = ledgerEntryId(request.params.id)
  const input = readLedgerEntryInput(request.body)
  const campus = resolveAdminCampus(request)
  const updated = await transaction(async connection => {
    const [rows] = await connection.execute(
      'SELECT id, entry_date, direction, category, amount, note FROM ledger_entries WHERE id = ? AND campus = ? FOR UPDATE',
      [id, campus]
    )
    const previous = rows[0]
    if (!previous) throw new HttpError(404, '账目不存在', 'LEDGER_ENTRY_NOT_FOUND')
    await connection.execute(
      `UPDATE ledger_entries
          SET entry_date = ?, direction = ?, category = ?, amount = ?, note = ?,
              updated_by = ?, updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [input.entryDate, input.direction, input.category, input.amount, input.note, request.admin.id, id]
    )
    await writeAudit(connection, request, 'ledger_entry_updated', 'ledger_entry', id, {
      // 审计里同时留下改动前后，事后对账时才能看出这笔数是怎么变的
      before: {
        entryDate: normalizeDayKey(previous.entry_date),
        direction: previous.direction,
        category: previous.category,
        amount: Number(previous.amount) || 0,
        note: previous.note || ''
      },
      after: {
        entryDate: input.entryDate,
        direction: input.direction,
        category: input.category,
        amount: input.amount,
        note: input.note
      }
    })
    return true
  })
  const [rows] = await pool.query(`${LEDGER_ENTRY_SELECT} WHERE e.id = ? LIMIT 1`, [id])
  return sendIdempotent(request, response, { item: rows[0] ? mapLedgerEntry(rows[0]) : null, updated })
}))

// 删除走 POST /:id/delete 而不是 HTTP DELETE：CORS 白名单只放行 GET/POST/PUT/OPTIONS，
// DELETE 会被浏览器预检拦掉；本仓库所有子资源改动也都是 POST /资源/:id/动词。
router.post('/ledger-entries/:id/delete', requireRoles('operator', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = ledgerEntryId(request.params.id)
  const campus = resolveAdminCampus(request)
  const deleted = await transaction(async connection => {
    const [rows] = await connection.execute(
      'SELECT id, entry_date, direction, category, amount, note FROM ledger_entries WHERE id = ? AND campus = ? FOR UPDATE',
      [id, campus]
    )
    const entry = rows[0]
    if (!entry) throw new HttpError(404, '账目不存在', 'LEDGER_ENTRY_NOT_FOUND')
    await connection.execute('DELETE FROM ledger_entries WHERE id = ?', [id])
    // 删掉就没了，所以审计里存下整行——这是唯一还能还原这笔账的地方
    await writeAudit(connection, request, 'ledger_entry_deleted', 'ledger_entry', id, {
      entryDate: normalizeDayKey(entry.entry_date),
      direction: entry.direction,
      category: entry.category,
      categoryText: ledgerCategoryLabel(entry.category),
      amount: Number(entry.amount) || 0,
      note: entry.note || ''
    })
    return true
  })
  return sendIdempotent(request, response, { id, deleted })
}))

router.get('/orders', requireRoles('operator', 'customer_service', 'finance', 'auditor'), asyncRoute(async (request, response) => {
  const page = validate.integer(request.query.page || 1, '页码', { min: 1, max: 100000 })
  const pageSize = validate.integer(request.query.pageSize || 20, '每页数量', { min: 1, max: 100 })
  const keyword = validate.string(request.query.keyword, '搜索词', { max: 80 })
  const status = validate.string(request.query.status, '订单状态', { max: 20 })
  if (status && !orderStatuses.includes(status)) throw new HttpError(400, '订单状态无效', 'INVALID_ORDER_STATUS')

  const where = []
  const values = []
  const campus = resolveAdminCampus(request)
  where.push('o.campus = ?')
  values.push(campus)
  if (status) { where.push('o.status = ?'); values.push(status) }
  if (keyword) {
    where.push(`(o.id LIKE ? OR o.contact_name LIKE ? OR o.phone LIKE ? OR r.name LIKE ? OR CONCAT(o.building, o.room) LIKE ?)`)
    const like = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`
    values.push(like, like, like, like, like)
  }
  const condition = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const offset = (page - 1) * pageSize
  const [[items], [countRows]] = await Promise.all([
    pool.query(
      `SELECT o.id, o.contact_name, o.phone, o.building, o.room, o.pieces, o.is_large, o.no_upstairs,
               o.urgency, o.pickup_scope, o.campus, o.address, o.pickup_station, o.pricing_model, o.pricing_version, o.item_details_json, o.item_subtotal,
               o.bundle_discount, o.urgency_fee, o.door_fee, o.building_fee, o.original_price, o.paid_amount, o.status,
               o.rider_id, o.rider_income, o.income_frozen_at, o.settled_at, o.withhold_rider_income,
               refund.amount AS refund_amount, refund.status AS refund_status, refund.last_error AS refund_last_error,
               (SELECT COUNT(*) FROM order_attachments oa_count WHERE oa_count.order_id = o.id) AS attachment_count,
               COALESCE(NULLIF(r.name_note,''), r.name) AS rider_name, r.phone AS rider_phone, ${mysqlTimestamp('o.created_at')} AS created_at_ms, ${mysqlTimestamp('o.deadline_at')} AS deadline_at_ms
         FROM orders o
         LEFT JOIN riders r ON r.id = o.rider_id
         LEFT JOIN order_refunds refund ON refund.order_id = o.id
         ${condition}
        ORDER BY o.created_at DESC
        LIMIT ? OFFSET ?`,
      [...values, pageSize, offset]
    ),
    pool.query(
      `SELECT COUNT(*) AS total FROM orders o LEFT JOIN riders r ON r.id = o.rider_id ${condition}`,
      values
    )
  ])
  return ok(response, { items: items.map(mapOrder), total: Number(countRows[0].total), page, pageSize })
}))

router.get('/orders/:id/attachments', requireRoles('operator', 'customer_service', 'auditor'), asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const [orders] = await pool.execute('SELECT id FROM orders WHERE id = ? LIMIT 1', [orderId])
  if (!orders.length) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
  const [rows] = await pool.execute(
    `SELECT up.id, oa.kind, up.mime_type, up.file_size, ${mysqlTimestamp('oa.created_at')} AS created_at_ms
       FROM order_attachments oa
       JOIN order_uploads up ON up.id = oa.upload_id
      WHERE oa.order_id = ? AND up.status = 'attached'
      ORDER BY oa.created_at ASC, up.id ASC`,
    [orderId]
  )
  return ok(response, {
    orderId,
    items: rows.map(item => ({
      id: item.id,
      kind: item.kind,
      kindText: item.kind === 'delivery' ? '送达凭证' : '取件截图',
      mimeType: item.mime_type,
      fileSize: Number(item.file_size) || 0,
      createdAtMs: Number(item.created_at_ms) || 0,
      downloadName: attachmentDownloadName(orderId, item.kind, item.id, item.mime_type)
    }))
  })
}))

router.get('/orders/:orderId/attachments/:attachmentId', requireRoles('operator', 'customer_service', 'auditor'), asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.orderId, '订单编号', { min: 8, max: 32 })
  const attachmentId = validate.string(request.params.attachmentId, '图片凭证', { min: 16, max: 64 })
  const [rows] = await pool.execute(
    `SELECT up.id, oa.kind, up.storage_path, up.mime_type, up.file_size
       FROM order_attachments oa
       JOIN order_uploads up ON up.id = oa.upload_id
      WHERE oa.order_id = ? AND oa.upload_id = ? AND up.status = 'attached'
      LIMIT 1`,
    [orderId, attachmentId]
  )
  const item = rows[0]
  if (!item) throw new HttpError(404, '图片不存在', 'ADMIN_ATTACHMENT_NOT_FOUND')
  const configuredPath = resolveAttachmentPath(config.uploadDir, item.storage_path, item.mime_type)
  let absolutePath
  let stat
  try {
    const [realUploadDir, realAttachmentPath] = await Promise.all([
      fs.realpath(config.uploadDir),
      fs.realpath(configuredPath)
    ])
    absolutePath = resolveAttachmentPath(realUploadDir, realAttachmentPath, item.mime_type)
    stat = await fs.stat(absolutePath)
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new HttpError(404, '图片不存在', 'ADMIN_ATTACHMENT_NOT_FOUND')
    throw error
  }
  if (!stat.isFile() || stat.size <= 0) throw new HttpError(404, '图片不存在', 'ADMIN_ATTACHMENT_NOT_FOUND')

  const download = request.query.download === '1'
  const downloadName = attachmentDownloadName(orderId, item.kind, item.id, item.mime_type)
  await writeAudit(
    pool,
    request,
    download ? 'download_order_attachment' : 'view_order_attachment',
    'order_attachment',
    attachmentId,
    { orderId, kind: item.kind, mimeType: item.mime_type, fileSize: Number(item.file_size) || stat.size }
  )

  response.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0')
  response.setHeader('Pragma', 'no-cache')
  response.setHeader('Expires', '0')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-site')
  response.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${downloadName}"`)
  response.type(item.mime_type)
  return response.sendFile(absolutePath, { acceptRanges: false, cacheControl: false, dotfiles: 'deny' })
}))

// 正式支付已统一由 XorPay 回调确认；保留明确的停用响应，防止旧管理台误写付款金额。
router.post('/orders/:id/confirm-payment', requireRoles('operator', 'finance'), requireIdempotency, asyncRoute(async (request, response) => {
  throw new HttpError(410, '线下确认收款已停用，请以 XorPay 支付回调为准', 'MANUAL_PAYMENT_DISABLED')
}))

router.post('/orders/:id/cancel', requireRoles('operator', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const result = await transaction(async connection => {
    const [rows] = await connection.execute(
      'SELECT id, user_id, status, deadline_at, paid_amount, payment_aoid FROM orders WHERE id = ? LIMIT 1 FOR UPDATE',
      [orderId]
    )
    const order = rows[0]
    if (!order) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
    if (order.status === 'cancelled') return { orderId, refund: null, alreadyCancelled: true }
    if (order.status === 'completed') throw new HttpError(409, '已完成订单不能取消', 'ORDER_COMPLETED_CANNOT_CANCEL')
    await writeAudit(connection, request, 'order_cancelled', 'order', orderId, { reason: 'admin_cancel', previousStatus: order.status })
    return cancelLockedOrder(connection, order, 'admin_cancel')
  })
  let refund = result.refund
  if (refund && ['pending', 'retryable'].includes(refund.status)) {
    refund = await processRefundByOrderId(orderId)
  }
  const [orderRows] = await pool.query('SELECT id, status, paid_amount FROM orders WHERE id = ?', [orderId])
  const order = orderRows[0]
  return sendIdempotent(request, response, {
    orderId,
    status: order ? order.status : 'cancelled',
    paidAmount: order ? Number(order.paid_amount) : 0,
    refund,
    alreadyCancelled: Boolean(result.alreadyCancelled)
  })
}))

router.post('/orders/:id/withhold-rider-income', requireRoles('operator', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const orderId = validate.string(request.params.id, '订单编号', { min: 8, max: 32 })
  const result = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId])
    const order = rows[0]
    if (!order) throw new HttpError(404, '订单不存在', 'ORDER_NOT_FOUND')
    if (!order.rider_id) throw new HttpError(409, '该订单尚无骑手，无需设置', 'ORDER_NO_RIDER')
    if (order.withhold_rider_income) throw new HttpError(409, '该订单已标记为不划给骑手', 'ORDER_RIDER_INCOME_WITHHELD')
    if (order.settled_at) throw new HttpError(409, '该订单骑手收入已结算，无法再设置', 'ORDER_RIDER_INCOME_SETTLED')
    if (order.income_frozen_at) throw new HttpError(409, '该订单骑手收入已冻结，无法再设置', 'ORDER_RIDER_INCOME_FROZEN')
    await connection.execute(
      'UPDATE orders SET withhold_rider_income = 1, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [orderId]
    )
    await writeAudit(connection, request, 'order_withhold_rider_income', 'order', orderId, { riderId: order.rider_id, riderIncome: Number(order.rider_income) || 0 })
    return { id: orderId, withholdRiderIncome: true }
  })
  return sendIdempotent(request, response, result)
}))

router.get('/riders/overview', requireRoles('operator', 'auditor'), asyncRoute(async (request, response) => {
  const campus = resolveAdminCampus(request)
  const [[applications], [riders]] = await Promise.all([
    pool.query(
      // 只回待审核的：已通过和已驳回的申请不属于「待审核申请」面板。
      // 通过的人已经在下面的「骑手名单」里，驳回的没有别处可看——这是 2026-09-21 拍板的取舍。
      // 原先这里查全部三种状态、用 FIELD() 把 pending 排最前，前端再靠三元把非 pending 行渲染成 '-'。
      `SELECT id, name, real_name, gender, student_id, phone, rules_version, status,
              ${mysqlTimestamp('submitted_at')} AS submitted_at_ms
         FROM rider_applications
        WHERE status = 'pending' AND campus = ?
        ORDER BY submitted_at DESC
        LIMIT 500`,
      [campus]
    ),
    pool.query(
      `SELECT r.id, r.name, r.name_note, r.gender, r.student_id, r.phone, r.status, r.valid_overtimes,
              r.history_overtimes, r.experience_points, r.available_balance, r.frozen_balance,
              COUNT(o.id) AS active_orders
         FROM riders r
         LEFT JOIN orders o ON o.rider_id = r.id
          AND o.status IN ('accepted','picked','delivering')
        WHERE r.campus = ?
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT 500`,
      [campus]
    )
  ])
  return ok(response, {
    applications: applications.map(item => ({
      id: String(item.id), name: item.name, realName: item.real_name || '', gender: item.gender || '', studentId: item.student_id, phone: item.phone,
      rulesVersion: item.rules_version, status: item.status,
      statusText: statusLabels[item.status] || item.status,
      submittedAtMs: Number(item.submitted_at_ms) || 0
    })),
    riders: riders.map(item => {
      const progress = getRiderProgress(item.experience_points, item.active_orders)
      return {
        id: String(item.id), name: item.name, nameNote: item.name_note || '', gender: item.gender || '', studentId: item.student_id, phone: item.phone,
        status: item.status, activeOrders: progress.activeCount,
        validOvertimes: Number(item.valid_overtimes), historyOvertimes: Number(item.history_overtimes),
        availableBalance: Number(item.available_balance), frozenBalance: Number(item.frozen_balance), experiencePoints: progress.experiencePoints,
        riderLevel: progress.level, riderLevelName: progress.levelName, maxActiveOrders: progress.maxActiveOrders
      }
    })
  })
}))

router.post('/rider-applications/:id/review', requireRoles('operator'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.integer(request.params.id, '申请编号', { min: 1, max: Number.MAX_SAFE_INTEGER })
  const approved = validate.boolean(request.body && request.body.approved, '审核结果')
  const reason = validate.string(request.body && request.body.reason, '审核说明', { min: 2, max: 300 })
  const result = await transaction(async connection => {
    const [initial] = await connection.execute('SELECT user_id FROM rider_applications WHERE id = ?', [id])
    if (!initial[0]) throw new HttpError(404, '骑手申请不存在', 'RIDER_APPLICATION_NOT_FOUND')
    const currentUser = await lockCampusUser(connection, initial[0].user_id)
    const [rows] = await connection.execute('SELECT * FROM rider_applications WHERE id = ? FOR UPDATE', [id])
    const application = rows[0]
    if (!application) throw new HttpError(404, '骑手申请不存在', 'RIDER_APPLICATION_NOT_FOUND')
    if (application.status !== 'pending') throw new HttpError(409, '该申请已经处理', 'RIDER_APPLICATION_REVIEWED')
    const status = approved ? 'approved' : 'rejected'
    await connection.execute(
      `UPDATE rider_applications
          SET status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [status, reason, request.admin.id, id]
    )
    if (approved) {
      const campus = normalizeCampusLenient(currentUser.campus)
      // 申请人自报的真实姓名/性别随审核通过写入骑手记录（§79）；重复审核时只在自报值非空时覆盖，
      // 避免抹掉客服后来手改的姓名备注/性别。phone 同理不在更新列里（双号码设计，§78）。
      await connection.execute(
        `INSERT INTO riders
           (user_id, application_id, name, student_id, phone, name_note, gender, campus, status, valid_overtimes, history_overtimes,
            available_balance, frozen_balance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', 0, 0, 0, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           application_id = VALUES(application_id), name = VALUES(name), student_id = VALUES(student_id),
           campus = VALUES(campus), status = 'approved',
           name_note = COALESCE(NULLIF(VALUES(name_note), ''), name_note),
           gender = COALESCE(VALUES(gender), gender),
           updated_at = UTC_TIMESTAMP()`,
        [application.user_id, id, application.name, application.student_id, application.phone,
         application.real_name || null, application.gender || null, campus]
      )
    }
    await writeAudit(connection, request, approved ? 'rider_application_approved' : 'rider_application_rejected', 'rider_application', id, { reason, realName: application.real_name || '', gender: application.gender || '' })
    return { id: String(id), status, statusText: statusLabels[status] }
  })
  return sendIdempotent(request, response, result)
}))

// 历史待审核校区申请仍供 admin/客服处理，使用与即时转区相同的订单约束。
// 骑手同步改 riders.campus（骑手只能服务单一校区，跟随账号校区）；订单 campus 是创建时快照，历史订单不受影响。
router.get('/campus-change-requests', requireRoles('admin', 'customer_service'), asyncRoute(async (request, response) => {
  const [items] = await pool.query(
    `SELECT r.id, r.user_id, r.from_campus, r.to_campus, r.reason, r.status, r.review_reason,
            u.nickname AS user_name, u.phone, reviewer.display_name AS reviewer_name,
            ${mysqlTimestamp('r.submitted_at')} AS submitted_at_ms,
            ${mysqlTimestamp('r.reviewed_at')} AS reviewed_at_ms
       FROM campus_change_requests r
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN admin_users reviewer ON reviewer.id = r.reviewed_by
      ORDER BY FIELD(r.status, 'pending', 'approved', 'rejected'), r.submitted_at DESC
      LIMIT 500`
  )
  return ok(response, {
    items: items.map(item => ({
      id: String(item.id),
      userId: String(item.user_id),
      userName: item.user_name || '',
      phone: item.phone || '',
      fromCampus: item.from_campus,
      toCampus: item.to_campus,
      reason: item.reason,
      status: item.status,
      statusText: statusLabels[item.status] || item.status,
      reviewReason: item.review_reason || '',
      reviewerName: item.reviewer_name || '',
      submittedAtMs: Number(item.submitted_at_ms) || 0,
      reviewedAtMs: Number(item.reviewed_at_ms) || 0
    })),
    total: items.length
  })
}))

router.post('/campus-change-requests/:id/review', requireRoles('admin', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.integer(request.params.id, '申请编号', { min: 1, max: Number.MAX_SAFE_INTEGER })
  const approved = validate.boolean(request.body && request.body.approved, '审核结果')
  const reason = validate.string(request.body && request.body.reason, '审核说明', { min: 2, max: 300 })
  const result = await transaction(async connection => {
    const [initial] = await connection.execute('SELECT user_id FROM campus_change_requests WHERE id = ?', [id])
    if (!initial[0]) throw new HttpError(404, '校区变更申请不存在', 'CAMPUS_CHANGE_NOT_FOUND')
    const currentUser = await lockCampusUser(connection, initial[0].user_id)
    const [rows] = await connection.execute('SELECT * FROM campus_change_requests WHERE id = ? FOR UPDATE', [id])
    const item = rows[0]
    if (!item) throw new HttpError(404, '校区变更申请不存在', 'CAMPUS_CHANGE_NOT_FOUND')
    if (item.status !== 'pending') throw new HttpError(409, '该申请已经处理', 'CAMPUS_CHANGE_REVIEWED')
    const status = approved ? 'approved' : 'rejected'
    if (approved) {
      await applyCampusChange(connection, currentUser, item.to_campus, item.from_campus)
    }
    await connection.execute(
      `UPDATE campus_change_requests
          SET status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [status, reason, request.admin.id, id]
    )
    await writeAudit(connection, request, approved ? 'campus_change_approved' : 'campus_change_rejected', 'campus_change_request', id, {
      userId: String(item.user_id),
      fromCampus: item.from_campus,
      toCampus: item.to_campus,
      reason
    })
    return { id: String(id), status, statusText: statusLabels[status] }
  })
  return sendIdempotent(request, response, result)
}))

// 骑手「姓名备注」：客服给骑手标注真实姓名/备注，用于区分昵称重复的骑手。留空=清除。
router.post('/riders/:id/name-note', requireRoles('operator'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.integer(request.params.id, '骑手编号', { min: 1, max: Number.MAX_SAFE_INTEGER })
  const nameNote = validate.string(request.body && request.body.nameNote, '姓名备注', { max: 40 })
  const result = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT id, name, name_note FROM riders WHERE id = ? FOR UPDATE', [id])
    const rider = rows[0]
    if (!rider) throw new HttpError(404, '骑手不存在', 'RIDER_NOT_FOUND')
    const before = rider.name_note || ''
    const after = nameNote
    if (before === after) return { id: String(id), nameNote: after }
    await connection.execute('UPDATE riders SET name_note = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [after || null, id])
    await writeAudit(connection, request, 'rider_name_note', 'rider', id, { before, after })
    return { id: String(id), nameNote: after }
  })
  return sendIdempotent(request, response, result)
}))

// 骑手性别：客服填写（male/female/空=未填）。用于南海「送上楼的单只有同性才能接」的限制。
router.post('/riders/:id/gender', requireRoles('operator'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.integer(request.params.id, '骑手编号', { min: 1, max: Number.MAX_SAFE_INTEGER })
  const raw = String(request.body && request.body.gender || '').trim()
  const gender = raw === '' ? '' : validate.oneOf(raw, '性别', ['male', 'female'])
  const result = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT id, name, gender FROM riders WHERE id = ? FOR UPDATE', [id])
    const rider = rows[0]
    if (!rider) throw new HttpError(404, '骑手不存在', 'RIDER_NOT_FOUND')
    const before = rider.gender || ''
    const after = gender
    if (before === after) return { id: String(id), gender: after }
    await connection.execute('UPDATE riders SET gender = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [after || null, id])
    await writeAudit(connection, request, 'rider_gender', 'rider', id, { before, after })
    return { id: String(id), gender: after }
  })
  return sendIdempotent(request, response, result)
}))

// 骑手联系电话：客服修正（riders.phone 是审核通过时从申请表的快照，可能填错，如骑手96曾填 12x 假号）。
// 必填、须为 11 位有效手机号（validate.phone 与前端 isPhone 同规则）。
router.post('/riders/:id/phone', requireRoles('operator'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.integer(request.params.id, '骑手编号', { min: 1, max: Number.MAX_SAFE_INTEGER })
  const phone = validate.phone(request.body && request.body.phone)
  const result = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT id, name, phone FROM riders WHERE id = ? FOR UPDATE', [id])
    const rider = rows[0]
    if (!rider) throw new HttpError(404, '骑手不存在', 'RIDER_NOT_FOUND')
    const before = rider.phone || ''
    const after = phone
    if (before === after) return { id: String(id), phone: after }
    await connection.execute('UPDATE riders SET phone = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?', [after, id])
    await writeAudit(connection, request, 'rider_phone_updated', 'rider', id, { before, after })
    return { id: String(id), phone: after }
  })
  return sendIdempotent(request, response, result)
}))

// 骑手资格操作：restore/suspend。⚠️ 此路由用 /riders/:id/:action 通配，必须注册在
// /riders/:id/name-note、/riders/:id/gender、/riders/:id/phone 之后，否则会把具体路径吞掉（报「骑手操作取值无效」）。
router.post('/riders/:id/:action', requireRoles('operator'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.integer(request.params.id, '骑手编号', { min: 1, max: Number.MAX_SAFE_INTEGER })
  const action = validate.oneOf(request.params.action, '骑手操作', ['restore', 'suspend'])
  const reason = validate.string(request.body && request.body.reason, '处理说明', { min: 2, max: 300 })
  const result = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT * FROM riders WHERE id = ? FOR UPDATE', [id])
    const rider = rows[0]
    if (!rider) throw new HttpError(404, '骑手不存在', 'RIDER_NOT_FOUND')
    const targetStatus = action === 'restore' ? 'approved' : 'suspended'
    const validOvertimesAfter = action === 'restore' ? 0 : Number(rider.valid_overtimes)
    await connection.execute(
      `UPDATE riders SET status = ?, valid_overtimes = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
      [targetStatus, validOvertimesAfter, id]
    )
    await connection.execute(
      `INSERT INTO rider_events
         (rider_id, event_type, valid_overtimes_before, valid_overtimes_after, reason, operator_admin_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [id, action, Number(rider.valid_overtimes), validOvertimesAfter, reason, request.admin.id]
    )
    await writeAudit(connection, request, `rider_${action}`, 'rider', id, {
      reason,
      validOvertimesBefore: Number(rider.valid_overtimes),
      validOvertimesAfter
    })
    return { id: String(id), status: targetStatus, validOvertimes: validOvertimesAfter }
  })
  return sendIdempotent(request, response, result)
}))

// 关闭同一订单下除 keepId 以外的未结售后记录（无赔付），返回被关闭的条数。
// 售后单允许同一订单多条（骑手每次上报异常都会新建），处理其中一条时其余条若不关闭，
// 会一直以 open 状态挂在售后理赔列表，表现为“已正常完成的订单仍有售后在途”。
async function closeSiblingAfterSales(connection, orderId, keepId, adminId, resolution) {
  const [result] = await connection.execute(
    `UPDATE after_sales
        SET status = 'resolved', resolution = ?, compensation_amount = 0,
            resolved_by = ?, resolved_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
      WHERE order_id = ? AND id <> ? AND status IN ('open', 'processing')`,
    [String(resolution || '').slice(0, 500), adminId, orderId, keepId]
  )
  return Number(result.affectedRows) || 0
}

router.get('/after-sales', requireRoles('operator', 'customer_service', 'auditor'), asyncRoute(async (request, response) => {
  const campus = resolveAdminCampus(request)
  const [items] = await pool.query(
    `SELECT a.id, a.order_id, a.type, a.item_value, a.claim_amount, a.compensation_amount,
            a.status, a.resolution, a.description, o.contact_name AS user_name, o.status AS order_status,
            o.paid_amount AS paid_amount, r.name AS rider_name, o.phone AS user_phone, r.phone AS rider_phone,
            rep.name AS reporter_rider_name,
            ${mysqlTimestamp('a.created_at')} AS created_at_ms
       FROM after_sales a
       JOIN orders o ON o.id = a.order_id
       LEFT JOIN riders r ON r.id = o.rider_id
       LEFT JOIN riders rep ON rep.id = a.rider_id
      WHERE o.campus = ?
      ORDER BY FIELD(a.status, 'open', 'processing', 'resolved'), a.created_at DESC
      LIMIT 500`,
    [campus]
  )
  return ok(response, {
    items: items.map(item => ({
      id: item.id, orderId: item.order_id, userName: item.user_name || '', riderName: item.rider_name || '',
      // 售后理赔列表要能直接联系双方，故带出两端手机号。订单未派骑手时 rider_phone 为 NULL（LEFT JOIN）。
      userPhone: item.user_phone || '', riderPhone: item.rider_phone || '',
      type: item.type, itemValue: Number(item.item_value), claimAmount: Number(item.claim_amount),
      compensationAmount: Number(item.compensation_amount), status: item.status,
      // 供管理台判断「转为正常完成」是否可用：该操作只有订单处于 disputed 时才合法。
      // 骑手上报异常只新增售后记录、不改订单状态，所以骑手异常单通常不是 disputed。
      orderStatus: item.order_status || '', paidAmount: Number(item.paid_amount) || 0, description: item.description || '',
      reporterRiderName: item.reporter_rider_name || '',
      resolution: item.resolution || '', createdAtMs: Number(item.created_at_ms) || 0
    })),
    total: items.length
  })
}))

router.post('/after-sales/:id/resolve', requireRoles('operator', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.string(request.params.id, '售后编号', { min: 1, max: 32 })
  const resolution = validate.string(request.body && request.body.resolution, '处理结论', { min: 2, max: 500 })
  const compensationAmount = validate.numeric(request.body && request.body.compensationAmount, '赔付金额', { min: 0, max: 200 })
  const result = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT * FROM after_sales WHERE id = ? FOR UPDATE', [id])
    const item = rows[0]
    if (!item) throw new HttpError(404, '售后记录不存在', 'AFTER_SALE_NOT_FOUND')
    if (item.status === 'resolved') throw new HttpError(409, '该售后已经处理', 'AFTER_SALE_RESOLVED')
    const settings = await readSettings(connection)
    const maximum = Number(item.item_value) > 0 ? Math.min(Number(settings.claimLimit), Number(item.item_value)) : Number(settings.claimLimit)
    if (compensationAmount > maximum) {
      throw new HttpError(400, `赔付金额不能超过${maximum.toFixed(2)}元`, 'COMPENSATION_LIMIT_EXCEEDED')
    }
    await connection.execute(
      `UPDATE after_sales
          SET status = 'resolved', resolution = ?, compensation_amount = ?, resolved_by = ?,
              resolved_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [resolution, compensationAmount, request.admin.id, id]
    )
    // 同订单的其他未结售后一并关闭：同一单重复上报（如同一异常报两次）会残留 open 记录长期挂在售后理赔列表
    const closedSiblings = await closeSiblingAfterSales(connection, item.order_id, id, request.admin.id, `同单其他售后已一并处理：${resolution}`)
    await writeAudit(connection, request, 'after_sale_resolved', 'after_sale', id, { resolution, compensationAmount, closedSiblingCount: closedSiblings })
    return { id, status: 'resolved', resolution, compensationAmount, closedSiblingCount: closedSiblings }
  })
  return sendIdempotent(request, response, result)
}))

router.post('/after-sales/:id/convert-completed', requireRoles('operator', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.string(request.params.id, '售后编号', { min: 1, max: 32 })
  const result = await transaction(async connection => {
    const [afterSaleRows] = await connection.execute('SELECT * FROM after_sales WHERE id = ? FOR UPDATE', [id])
    const afterSale = afterSaleRows[0]
    if (!afterSale) throw new HttpError(404, '售后记录不存在', 'AFTER_SALE_NOT_FOUND')
    if (afterSale.status === 'resolved') throw new HttpError(409, '该售后已经处理', 'AFTER_SALE_RESOLVED')

    const [orderRows] = await connection.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [afterSale.order_id])
    const order = orderRows[0]
    if (!order) throw new HttpError(404, '关联订单不存在', 'ORDER_NOT_FOUND')
    if (order.status !== 'disputed') throw new HttpError(409, '该订单不在售后中，无法转为正常完成', 'ORDER_NOT_DISPUTED')
    if (!order.rider_id) throw new HttpError(409, '该订单没有骑手，无法结算收入', 'ORDER_NO_RIDER')

    const riderIncome = Number(order.rider_income) || 0
    const withhold = Boolean(order.withhold_rider_income)

    // 1) 售后记录 → resolved（骑手无责，无赔付）
    await connection.execute(
      `UPDATE after_sales
          SET status = 'resolved', resolution = '正常完成，骑手无责', compensation_amount = 0,
              resolved_by = ?, resolved_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [request.admin.id, id]
    )
    // 同订单的其他未结售后一并关闭，避免重复上报残留为“孤儿”记录
    const closedSiblings = await closeSiblingAfterSales(connection, order.id, id, request.admin.id, '正常完成，骑手无责（同单售后一并处理）')

    // 2) 立即结算骑手收入（跳过观察期）；被标记「不划给骑手」的单跳过结算
    if (!withhold) {
      if (order.settled_at) {
        // 此前已结算到可提现余额，避免重复入账
      } else if (order.income_frozen_at) {
        // 已冻结未结算：从冻结余额转入可提现
        await connection.execute(
          'UPDATE riders SET frozen_balance = GREATEST(frozen_balance - ?, 0), available_balance = available_balance + ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
          [riderIncome, riderIncome, order.rider_id]
        )
      } else {
        // 从未冻结：直接计入可提现
        await connection.execute(
          'UPDATE riders SET available_balance = available_balance + ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
          [riderIncome, order.rider_id]
        )
      }
    }

    // 3) 订单 → completed（回填完成/冻结时间，结算时间 = 现在）
    await connection.execute(
      `UPDATE orders
          SET status = 'completed',
              completed_at = COALESCE(completed_at, UTC_TIMESTAMP()),
              income_frozen_at = COALESCE(income_frozen_at, UTC_TIMESTAMP()),
              settled_at = COALESCE(settled_at, UTC_TIMESTAMP()),
              updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [order.id]
    )

    // 4) 补发完成单经验（幂等）
    await awardCompletedOrderExperience(connection, order.id)

    await writeAudit(connection, request, 'after_sale_convert_completed', 'after_sale', id, { orderId: order.id, riderId: order.rider_id, riderIncome, closedSiblingCount: closedSiblings })

    return { id, orderId: order.id, status: 'completed', riderIncome, closedSiblingCount: closedSiblings }
  })
  return sendIdempotent(request, response, result)
}))

router.get('/feedbacks', requireRoles('operator', 'customer_service', 'auditor'), asyncRoute(async (request, response) => {
  const campus = resolveAdminCampus(request)
  const [items] = await pool.query(
    `SELECT f.id, f.category, f.content, f.status,
            u.nickname AS user_name, u.phone, u.building, u.room,
            ${mysqlTimestamp('f.created_at')} AS created_at_ms
       FROM feedbacks f
       LEFT JOIN users u ON u.id = f.user_id
      WHERE u.campus = ?
      ORDER BY FIELD(f.status, 'unread', 'read', 'resolved'), f.created_at DESC
      LIMIT 500`,
    [campus]
  )
  return ok(response, {
    items: items.map(item => ({
      id: String(item.id), category: item.category, content: item.content, status: item.status,
      userName: item.user_name || '', phone: item.phone || '',
      building: formatDormBuilding(item.building, campus), room: item.room || '',
      createdAtMs: Number(item.created_at_ms) || 0
    })),
    total: items.length
  })
}))

router.post('/feedbacks/:id/status', requireRoles('operator', 'customer_service'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.integer(request.params.id, '意见编号', { min: 1, max: Number.MAX_SAFE_INTEGER })
  const status = validate.oneOf(request.body && request.body.status, '处理状态', ['read', 'resolved'])
  const result = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT * FROM feedbacks WHERE id = ? FOR UPDATE', [id])
    const item = rows[0]
    if (!item) throw new HttpError(404, '意见不存在', 'FEEDBACK_NOT_FOUND')
    if (item.status === 'resolved' && status !== 'resolved') throw new HttpError(409, '已处理的意见不能回退状态', 'FEEDBACK_RESOLVED')
    await connection.execute(
      'UPDATE feedbacks SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?',
      [status, id]
    )
    await writeAudit(connection, request, `feedback_${status}`, 'feedback', id, { category: item.category })
    return { id: String(id), status }
  })
  return sendIdempotent(request, response, result)
}))

router.get('/coupons/overview', requireRoles('operator', 'auditor'), asyncRoute(async (request, response) => {
  const campus = resolveAdminCampus(request)
  const [[statsRows], [campaigns]] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) AS total,
              SUM(status = 'available' AND expires_at > UTC_TIMESTAMP()) AS available,
              SUM(status = 'used') AS used,
              SUM(status = 'expired' OR (status = 'available' AND expires_at <= UTC_TIMESTAMP())) AS expired
         FROM user_coupons
        WHERE campus IS NULL OR campus = ?`,
      [campus]
    ),
    pool.query(
      `SELECT id, name, amount, min_spend, campus, issued_count, used_count, status
         FROM coupon_campaigns
        WHERE campus IS NULL OR campus = ?
        ORDER BY created_at DESC
        LIMIT 200`,
      [campus]
    )
  ])
  const stats = statsRows[0] || {}
  return ok(response, {
    stats: {
      total: Number(stats.total) || 0,
      available: Number(stats.available) || 0,
      used: Number(stats.used) || 0,
      expired: Number(stats.expired) || 0
    },
    campaigns: campaigns.map(item => ({
      id: String(item.id), name: item.name, amount: Number(item.amount), minSpend: Number(item.min_spend),
      campus: item.campus || '', issued: Number(item.issued_count), used: Number(item.used_count), status: item.status
    }))
  })
}))

router.post('/coupons/grants', requireRoles('operator'), requireIdempotency, asyncRoute(async (request, response) => {
  const body = request.body || {}
  const name = validate.string(body.name, '活动名称', { min: 2, max: 30 })
  const scope = validate.oneOf(body.scope, '发放范围', ['single', 'all'])
  const targetPhone = validate.phone(body.phone, scope === 'single')
  const quantity = validate.integer(body.quantity, '发放数量', { min: 1, max: 100000 })
  const amount = validate.numeric(body.amount, '券面金额', { min: 0.01, max: 200 })
  const minSpend = validate.numeric(body.minSpend || 0, '使用门槛', { min: 0, max: 999 })
  const validDays = validate.integer(body.validDays, '有效天数', { min: 1, max: 365 })
  // 校区：客服锁定本校区、老板可切（resolveAdminCampus 已处理越权回落）；campus 写进活动与用户券。
  const campus = resolveAdminCampus(request)
  const result = await transaction(async connection => {
    let users
    if (scope === 'single') {
      const [rows] = await connection.execute('SELECT id, campus AS user_campus FROM users WHERE phone = ? AND status = \'active\' LIMIT 1', [targetPhone])
      users = rows
      if (!users.length) throw new HttpError(404, '未找到该手机号对应的用户', 'USER_NOT_FOUND')
      if (rows[0].user_campus !== campus) throw new HttpError(409, '该用户不在当前校区，无法在当前校区发券', 'USER_CAMPUS_MISMATCH')
    } else {
      const [rows] = await connection.query('SELECT id FROM users WHERE status = \'active\' AND campus = ? ORDER BY id LIMIT 100000', [campus])
      users = rows
      if (!users.length) throw new HttpError(409, '当前没有可发券的注册用户', 'NO_ACTIVE_USERS')
    }
    const totalIssued = users.length * quantity
    if (totalIssued > 100000) throw new HttpError(400, '本次发券总量不能超过100000张', 'COUPON_GRANT_LIMIT')
    const [campaignResult] = await connection.execute(
      `INSERT INTO coupon_campaigns
         (name, amount, min_spend, valid_days, scope, campus, issued_count, used_count, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'running', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [name, amount, minSpend, validDays, scope, campus, totalIssued, request.admin.id]
    )
    const expiresAt = new Date(Date.now() + validDays * 86400000)
    const values = []
    for (const user of users) {
      for (let index = 0; index < quantity; index += 1) {
        values.push([user.id, campaignResult.insertId, name, amount, minSpend, 'available', campus, expiresAt])
      }
    }
    for (let offset = 0; offset < values.length; offset += 500) {
      const chunk = values.slice(offset, offset + 500)
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())').join(',')
      await connection.query(
        `INSERT INTO user_coupons
           (user_id, campaign_id, name, amount, min_spend, status, campus, expires_at, created_at, updated_at)
         VALUES ${placeholders}`,
        chunk.flat()
      )
    }
    await writeAudit(connection, request, 'coupon_granted', 'coupon_campaign', campaignResult.insertId, {
      name, scope, campus, targetPhone: targetPhone || null, quantity, users: users.length, totalIssued, amount, minSpend, validDays
    })
    return { id: String(campaignResult.insertId), name, campus, issued: totalIssued, status: 'running' }
  })
  return sendIdempotent(request, response, result, 201)
}))

router.post('/coupon-codes', requireRoles('operator'), requireIdempotency, asyncRoute(async (request, response) => {
  const body = request.body || {}
  const name = validate.string(body.name, '优惠券名称', { min: 2, max: 30 })
  const amount = validate.numeric(body.amount, '券面金额', { min: 0.01, max: 200 })
  const minSpend = validate.numeric(body.minSpend || 0, '使用门槛', { min: 0, max: 999 })
  const validDays = validate.integer(body.validDays || 7, '有效天数', { min: 1, max: 365 })
  const campus = resolveAdminCampus(request)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'XY'
  const bytes = crypto.randomBytes(10)
  for (let index = 0; index < 10; index += 1) code += alphabet[bytes[index] % alphabet.length]
  const codeHash = crypto.createHash('sha256').update(code).digest('hex')
  const result = await transaction(async connection => {
    const [insert] = await connection.execute(
      `INSERT INTO coupon_codes
         (code_hash, code_hint, name, amount, min_spend, status, campus, expires_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'available', ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [codeHash, code.slice(-4), name, amount, minSpend, campus, validDays, request.admin.id]
    )
    await writeAudit(connection, request, 'coupon_code_created', 'coupon_code', insert.insertId, {
      codeHint: code.slice(-4), name, amount, minSpend, campus, validDays
    })
    return { id: String(insert.insertId), code, name, amount, minSpend, campus, validDays, status: 'available' }
  })
  return sendIdempotent(request, response, result, 201)
}))

router.post('/settings/review-mode', requireRoles('admin'), asyncRoute(async (request, response) => {
  const enabled = validate.boolean(request.body && request.body.enabled, '审核模式')
  await transaction(async connection => {
    // 这是整站开关（review_mode=1 时用户付不了钱、骑手钱包不加载），必须留痕，否则查不出是谁在什么时候翻的。
    const [result] = await connection.execute(
      'UPDATE platform_settings SET review_mode = ?, updated_at = UTC_TIMESTAMP() WHERE campus IS NOT NULL',
      [enabled ? 1 : 0]
    )
    // 设置行不存在时不能写审计——否则日志会记下一次并未发生的变更。
    if (!result.affectedRows) throw new HttpError(503, '平台设置尚未初始化', 'SETTINGS_NOT_INITIALIZED')
    await writeAudit(connection, request, 'review_mode_updated', 'platform_settings', '1', { reviewMode: enabled })
  })
  return ok(response, { reviewMode: enabled })
}))

router.get('/withdrawals', requireRoles('finance', 'auditor'), asyncRoute(async (request, response) => {
  const campus = resolveAdminCampus(request)
  const [items] = await pool.query(
    `SELECT w.id, w.amount, w.status, w.reason, r.name AS rider_name, r.name_note, r.phone,
            ${mysqlTimestamp('w.requested_at')} AS requested_at_ms
       FROM withdrawals w
       JOIN riders r ON r.id = w.rider_id
      WHERE r.campus = ?
      ORDER BY FIELD(w.status, 'pending', 'paid', 'rejected'), w.requested_at DESC
      LIMIT 500`,
    [campus]
  )
  return ok(response, {
    items: items.map(item => ({
      id: String(item.id), riderName: item.rider_name, nameNote: item.name_note || '', phone: item.phone,
      amount: Number(item.amount), status: item.status, reason: item.reason || '',
      requestedAtMs: Number(item.requested_at_ms) || 0
    })),
    total: items.length
  })
}))

router.post('/withdrawals/:id/review', requireRoles('finance'), requireIdempotency, asyncRoute(async (request, response) => {
  const id = validate.integer(request.params.id, '提现编号', { min: 1, max: Number.MAX_SAFE_INTEGER })
  const approved = validate.boolean(request.body && request.body.approved, '审核结果')
  const reason = validate.string(request.body && request.body.reason, '审核说明', { min: 2, max: 300 })
  if (approved && !config.manualPayoutMode) {
    throw new HttpError(503, '尚未启用人工打款确认模式', 'PAYOUT_MODE_DISABLED')
  }
  const result = await transaction(async connection => {
    const [rows] = await connection.execute(
      `SELECT w.*, r.available_balance, r.email FROM withdrawals w
        JOIN riders r ON r.id = w.rider_id WHERE w.id = ? FOR UPDATE`,
      [id]
    )
    const item = rows[0]
    if (!item) throw new HttpError(404, '提现申请不存在', 'WITHDRAWAL_NOT_FOUND')
    if (item.status !== 'pending') throw new HttpError(409, '该提现申请已经处理', 'WITHDRAWAL_REVIEWED')
    // 申请时不扣余额，审批通过后在此扣款；驳回不做余额变动
    const status = approved ? 'paid' : 'rejected'
    let settledOrders = []
    if (approved) {
      if (Number(item.available_balance) < Number(item.amount)) {
        throw new HttpError(409, '骑手可提现余额不足', 'INSUFFICIENT_RIDER_BALANCE')
      }
      await connection.execute(
        `UPDATE riders SET available_balance = available_balance - ?, updated_at = UTC_TIMESTAMP() WHERE id = ?`,
        [item.amount, item.rider_id]
      )
      // 全额提现：把「申请时点前已结算且未提现」的订单打上已提现标记，骑手钱包明细随后隐藏它们。
      // 先 SELECT FOR UPDATE 锁住本批订单并快照明细（用于提现回执邮件），WHERE 与下面 UPDATE 完全一致，
      // 保证「邮件列的订单」==「实际标记 withdrawn_at 的订单」。
      const [orderRows] = await connection.execute(
        `SELECT id, rider_income, campus, building, room, pieces,
                DATE_FORMAT(CONVERT_TZ(completed_at, '+00:00', '+08:00'), '%Y-%m-%d') AS completed_date
           FROM orders
          WHERE rider_id = ? AND status = 'completed' AND withhold_rider_income = 0
            AND settled_at IS NOT NULL AND withdrawn_at IS NULL AND settled_at <= ?
          ORDER BY completed_at ASC
          FOR UPDATE`,
        [item.rider_id, item.requested_at]
      )
      settledOrders = orderRows
      await connection.execute(
        `UPDATE orders SET withdrawn_at = UTC_TIMESTAMP()
          WHERE rider_id = ? AND status = 'completed' AND withhold_rider_income = 0
            AND settled_at IS NOT NULL AND withdrawn_at IS NULL AND settled_at <= ?`,
        [item.rider_id, item.requested_at]
      )
    }
    await connection.execute(
      `UPDATE withdrawals
          SET status = ?, reason = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(),
              paid_at = IF(? = 'paid', UTC_TIMESTAMP(), NULL), updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [status, reason, request.admin.id, status, id]
    )
    await writeAudit(connection, request, approved ? 'withdrawal_paid' : 'withdrawal_rejected', 'withdrawal', id, {
      riderId: String(item.rider_id), amount: Number(item.amount), reason
    })
    return { id: String(id), status, reason, email: item.email, amount: Number(item.amount), orders: settledOrders }
  })
  // 提现通过后给骑手发「结清回执」邮件：异步直发，不阻塞审核响应；失败仅记日志（方案 A）。
  if (result.status === 'paid' && result.email) {
    setImmediate(() => {
      sendRiderWithdrawalEmail(result.email, buildWithdrawalEmail(result.amount, result.orders)).catch(error => {
        console.error(JSON.stringify({
          level: 'error',
          message: 'rider withdrawal email send failed',
          withdrawal_id: result.id,
          error_code: String(error && error.code || error.name || 'EMAIL_ERROR').replace(/[^a-zA-Z0-9_.:-]/g, '')
        }))
      })
    })
  }
  return sendIdempotent(request, response, { id: result.id, status: result.status, reason: result.reason })
}))

router.get('/settings', requireRoles('admin', 'auditor'), asyncRoute(async (request, response) => {
  return ok(response, await readSettings(pool, resolveAdminCampus(request)))
}))

const READ_ONLY_PRICING_FIELDS = Object.freeze([
  'campusPrice', 'offCampusPrice', 'campusUrgentPrice', 'offCampusUrgentPrice', 'extraPiecePrice', 'largePrice',
  'itemSmallCampusPrice', 'itemSmallOffCampusPrice', 'itemMediumCampusPrice', 'itemMediumOffCampusPrice',
  'itemLargeCampusPrice', 'itemLargeOffCampusPrice', 'itemUrgentFee', 'itemDoorFee',
  'itemBuilding9Fee', 'itemUpperFloorDoorFee',
  'bundleTier0Threshold', 'bundleTier0Discount',
  'bundleTier1Threshold', 'bundleTier1Discount', 'bundleTier2Threshold', 'bundleTier2Discount',
  'commissionRate'
])

function rejectPricingChanges(body, current) {
  for (const field of READ_ONLY_PRICING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const submitted = Number(body[field])
    if (!Number.isFinite(submitted) || Math.abs(submitted - Number(current[field])) > 0.0001) {
      throw new HttpError(409, '正式价格随小程序版本发布，不能在管理台单独修改', 'PRICE_SETTINGS_READ_ONLY')
    }
  }
}

router.put('/settings', requireRoles('admin'), requireIdempotency, asyncRoute(async (request, response) => {
  const body = request.body || {}
  const current = await readSettings()
  rejectPricingChanges(body, current)
  const settings = {
    campusPrice: current.campusPrice,
    offCampusPrice: current.offCampusPrice,
    campusUrgentPrice: current.campusUrgentPrice,
    offCampusUrgentPrice: current.offCampusUrgentPrice,
    extraPiecePrice: current.extraPiecePrice,
    largePrice: current.largePrice,
    itemSmallCampusPrice: current.itemSmallCampusPrice,
    itemSmallOffCampusPrice: current.itemSmallOffCampusPrice,
    itemMediumCampusPrice: current.itemMediumCampusPrice,
    itemMediumOffCampusPrice: current.itemMediumOffCampusPrice,
    itemLargeCampusPrice: current.itemLargeCampusPrice,
    itemLargeOffCampusPrice: current.itemLargeOffCampusPrice,
    itemUrgentFee: current.itemUrgentFee,
    itemDoorFee: current.itemDoorFee,
    bundleTier1Threshold: current.bundleTier1Threshold,
    bundleTier1Discount: current.bundleTier1Discount,
    bundleTier2Threshold: current.bundleTier2Threshold,
    bundleTier2Discount: current.bundleTier2Discount,
    autoConfirmHours: validate.integer(body.autoConfirmHours, '自动完成小时', { min: 1, max: 72 }),
    observationHours: validate.integer(body.observationHours, '售后观察小时', { min: 1, max: 168 }),
    claimLimit: validate.numeric(body.claimLimit, '单笔理赔上限', { min: 0, max: 200 }),
    commissionRate: current.commissionRate,
    serviceStatus: validate.oneOf(body.serviceStatus, '服务状态', ['open', 'closed']),
    serviceNotice: validate.string(body.serviceNotice, '停服提示', { max: 200 })
  }
  const saved = await transaction(async connection => {
    // 方案A：营业状态/停服公告 + 自动完成/观察期/理赔上限是平台级运营开关，两校区同步（WHERE campus IS NOT NULL）；
    // 价格 + 佣金是每校区独立项，只写南海行（id=1），避免把南海价误覆盖到石牌行。
    const [existing] = await connection.execute('SELECT id FROM platform_settings WHERE id = 1 LIMIT 1')
    if (!existing.length) throw new HttpError(503, '平台设置尚未初始化', 'SETTINGS_NOT_INITIALIZED')
    await connection.execute(
      `UPDATE platform_settings SET
         campus_price = ?, off_campus_price = ?, campus_urgent_price = ?, off_campus_urgent_price = ?,
         extra_piece_price = ?, large_price = ?,
         item_small_campus_price = ?, item_small_off_campus_price = ?,
         item_medium_campus_price = ?, item_medium_off_campus_price = ?,
         item_large_campus_price = ?, item_large_off_campus_price = ?,
         item_urgent_fee = ?, item_door_fee = ?,
         bundle_tier1_threshold = ?, bundle_tier1_discount = ?,
         bundle_tier2_threshold = ?, bundle_tier2_discount = ?,
         commission_rate = ?,
         updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE id = 1`,
      [
        settings.campusPrice, settings.offCampusPrice, settings.campusUrgentPrice, settings.offCampusUrgentPrice,
        settings.extraPiecePrice, settings.largePrice,
        settings.itemSmallCampusPrice, settings.itemSmallOffCampusPrice,
        settings.itemMediumCampusPrice, settings.itemMediumOffCampusPrice,
        settings.itemLargeCampusPrice, settings.itemLargeOffCampusPrice,
        settings.itemUrgentFee, settings.itemDoorFee,
        settings.bundleTier1Threshold, settings.bundleTier1Discount,
        settings.bundleTier2Threshold, settings.bundleTier2Discount,
        settings.commissionRate,
        request.admin.id
      ]
    )
    await connection.execute(
      `UPDATE platform_settings SET
         auto_confirm_hours = ?, observation_hours = ?, claim_limit = ?,
         service_status = ?, service_notice = ?,
         updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE campus IS NOT NULL`,
      [
        settings.autoConfirmHours, settings.observationHours, settings.claimLimit,
        settings.serviceStatus, settings.serviceNotice, request.admin.id
      ]
    )
    await writeAudit(connection, request, 'platform_settings_updated', 'platform_settings', '1', settings)
    return readSettings(connection)
  })
  return sendIdempotent(request, response, saved)
}))

router.put('/settings/operational', requireRoles('admin'), requireIdempotency, asyncRoute(async (request, response) => {
  const body = request.body || {}
  const settings = {
    autoConfirmHours: validate.integer(body.autoConfirmHours, '自动完成小时', { min: 1, max: 72 }),
    observationHours: validate.integer(body.observationHours, '售后观察小时', { min: 1, max: 168 }),
    claimLimit: validate.numeric(body.claimLimit, '单笔理赔上限', { min: 0, max: 200 })
  }
  const saved = await transaction(async connection => {
    const [updateResult] = await connection.execute(
      `UPDATE platform_settings SET
         auto_confirm_hours = ?, observation_hours = ?, claim_limit = ?,
         updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE campus IS NOT NULL`,
      [settings.autoConfirmHours, settings.observationHours, settings.claimLimit, request.admin.id]
    )
    if (!updateResult.affectedRows) throw new HttpError(503, '平台设置尚未初始化', 'SETTINGS_NOT_INITIALIZED')
    await writeAudit(connection, request, 'platform_settings_updated', 'platform_settings', '1', settings)
    return readSettings(connection)
  })
  return sendIdempotent(request, response, saved)
}))

router.put('/settings/service-status', requireRoles('admin'), requireIdempotency, asyncRoute(async (request, response) => {
  const body = request.body || {}
  const settings = {
    serviceStatus: validate.oneOf(body.serviceStatus, '服务状态', ['open', 'closed']),
    serviceNotice: validate.string(body.serviceNotice, '停服提示', { max: 200 })
  }
  const saved = await transaction(async connection => {
    const [updateResult] = await connection.execute(
      `UPDATE platform_settings SET
         service_status = ?, service_notice = ?,
         updated_by = ?, updated_at = UTC_TIMESTAMP()
       WHERE campus IS NOT NULL`,
      [settings.serviceStatus, settings.serviceNotice, request.admin.id]
    )
    if (!updateResult.affectedRows) throw new HttpError(503, '平台设置尚未初始化', 'SETTINGS_NOT_INITIALIZED')
    await writeAudit(connection, request, 'platform_settings_updated', 'platform_settings', '1', settings)
    return readSettings(connection)
  })
  return sendIdempotent(request, response, saved)
}))

module.exports = router
