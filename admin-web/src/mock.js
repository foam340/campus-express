const STORAGE_KEY = 'campus_admin_mock_v5'
const LEDGER_CATEGORIES = [
  { key:'rider_subsidy', label:'骑手补贴', direction:'expense' },
  { key:'flyer', label:'传单印刷', direction:'expense' },
  { key:'material', label:'物料采购', direction:'expense' },
  { key:'promotion', label:'推广投放', direction:'expense' },
  { key:'equipment', label:'设备耗材', direction:'expense' },
  { key:'other_expense', label:'其他支出', direction:'expense' },
  { key:'other_income', label:'其他收入', direction:'income' }
]
const LEDGER_CUSTOM_CATEGORY = 'custom'
const LEDGER_DIRECTION_LABELS = { income:'收入', expense:'支出' }
const LEDGER_CATEGORY_LABELS = Object.assign({ [LEDGER_CUSTOM_CATEGORY]:'自定义' }, ...LEDGER_CATEGORIES.map(item => ({ [item.key]:item.label })))

function seedState() {
  const now = Date.now()
  return {
    orders: [
      { id:'KD20260714000018', contactName:'林同学', phone:'13800009718', building:'7栋', room:'421', pieces:3, isLarge:false, urgency:'today', urgencyText:'今天', status:'delivering', statusText:'配送中', originalPrice:2.5, paidAmount:.5, riderName:'张同学', createdAtMs:now-42*60000, deadlineAtMs:now+4*3600000 },
      { id:'KD20260714000017', contactName:'陈同学', phone:'13600005521', building:'3栋', room:'612', pieces:2, isLarge:true, urgency:'urgent', urgencyText:'很急', status:'waiting', statusText:'待接单', originalPrice:5.5, paidAmount:5.5, riderName:'', createdAtMs:now-18*60000, deadlineAtMs:now+42*60000 },
      { id:'KD20260714000016', contactName:'周同学', phone:'13500001890', building:'8栋', room:'208', pieces:1, isLarge:false, urgency:'tomorrow', urgencyText:'明天', status:'waiting', statusText:'待接单', originalPrice:1, paidAmount:1, riderName:'', createdAtMs:now-55*60000, deadlineAtMs:now+24*3600000 },
      { id:'KD20260714000015', contactName:'王同学', phone:'13700004628', building:'6栋', room:'315', pieces:2, isLarge:false, urgency:'today', urgencyText:'今天', status:'accepted', statusText:'已接单', originalPrice:2, paidAmount:2, riderName:'小林', createdAtMs:now-92*60000, deadlineAtMs:now+4*3600000 },
      { id:'KD20260713000014', contactName:'许同学', phone:'13200003118', building:'1栋', room:'123', pieces:1, isLarge:false, urgency:'today', urgencyText:'今天', status:'completed', statusText:'已完成', originalPrice:1.5, paidAmount:0, riderName:'李同学', incomeFrozenAtMs:now-8*3600000, createdAtMs:now-20*3600000, deadlineAtMs:now-18*3600000 },
      { id:'KD20260713000013', contactName:'赵同学', phone:'13100001276', building:'4栋', room:'502', pieces:4, isLarge:true, urgency:'today', urgencyText:'今天', status:'disputed', statusText:'售后中', originalPrice:5, paidAmount:5, riderName:'黄同学', withholdRiderIncome:true, createdAtMs:now-23*3600000, deadlineAtMs:now-21*3600000 },
      { id:'KD20260713000012', contactName:'郭同学', phone:'13300006629', building:'2栋', room:'308', pieces:1, isLarge:false, urgency:'urgent', urgencyText:'很急', status:'cancelled', statusText:'已取消', originalPrice:3, paidAmount:3, riderName:'', createdAtMs:now-25*3600000, deadlineAtMs:now-24*3600000 },
      { id:'KD20260712000011', contactName:'何同学', phone:'13400002021', building:'5栋', room:'417', pieces:2, isLarge:false, urgency:'tomorrow', urgencyText:'明天', status:'completed', statusText:'已完成', originalPrice:1.5, paidAmount:1.5, riderName:'张同学', incomeFrozenAtMs:now-32*3600000, settledAtMs:now-8*3600000, createdAtMs:now-46*3600000, deadlineAtMs:now-22*3600000 }
    ],
    applications: [
      { id:'RA20260714001', name:'吴同学', studentId:'2026123008', phone:'13900007118', status:'pending', statusText:'等待审核', rulesVersion:'2026.07-v1', submittedAtMs:now-35*60000 },
      { id:'RA20260713002', name:'孙同学', studentId:'2026112016', phone:'13800008421', status:'pending', statusText:'等待审核', rulesVersion:'2026.07-v1', submittedAtMs:now-18*3600000 }
    ],
    riders: [
      { id:'R1001', name:'张同学', phone:'13900002316', studentId:'2025113021', status:'approved', activeOrders:1, validOvertimes:0, historyOvertimes:1, availableBalance:26.5, frozenBalance:12.5, experiencePoints:360, riderLevel:3, riderLevelName:'进阶骑手', maxActiveOrders:5 },
      { id:'R1002', name:'小林', phone:'13800009718', studentId:'2025124017', status:'approved', activeOrders:1, validOvertimes:2, historyOvertimes:3, availableBalance:18.5, frozenBalance:8, experiencePoints:120, riderLevel:2, riderLevelName:'熟练骑手', maxActiveOrders:4 },
      { id:'R1003', name:'黄同学', phone:'13700005231', studentId:'2024103028', status:'suspended', activeOrders:0, validOvertimes:3, historyOvertimes:4, availableBalance:7, frozenBalance:3, experiencePoints:40, riderLevel:1, riderLevelName:'新手骑手', maxActiveOrders:3 }
    ],
    afterSales: [
      { id:'AS20260714001', orderId:'KD20260713000013', userName:'赵同学', riderName:'黄同学', userPhone:'13800001111', riderPhone:'13700005231', type:'未收到快递', description:'用户反馈未收到快递，等待客服核实。', reporterRiderName:'', itemValue:86, claimAmount:86, status:'open', createdAtMs:now-2*3600000 },
      { id:'AS20260713002', orderId:'KD20260713000014', userName:'许同学', riderName:'李同学', userPhone:'13900002222', riderPhone:'13800009718', type:'包装破损', description:'骑手上报异常：包装破损', reporterRiderName:'李同学', itemValue:35, claimAmount:20, status:'processing', createdAtMs:now-16*3600000 }
    ],
    withdrawals: [
      { id:'WD20260714001', riderName:'张同学', phone:'13900002316', amount:26.5, status:'pending', requestedAtMs:now-28*60000 },
      { id:'WD20260713002', riderName:'李同学', phone:'13600003917', amount:14, status:'paid', requestedAtMs:now-22*3600000 }
    ],
    coupons: {
      stats:{ total:138, available:72, used:51, expired:15 },
      campaigns:[
        { id:'CG20260701', name:'新用户2元抵用券', amount:2, minSpend:0, campus:'nanhai', issued:86, used:39, status:'running' },
        { id:'CG20260702', name:'满5减3活动券', amount:3, minSpend:5, campus:'nanhai', issued:52, used:12, status:'running' }
      ], codes:[]
    },
    // 额外收支：今天两条（和订单日重叠）、45 天前一条（只有账目没有订单，用来验证
    // 后端「订单日 ∪ 账目日」的并集逻辑在前端也能正常渲染）
    ledgerEntries: [
      { id:'LE1001', entryDate:mockDayOffset(0), direction:'expense', category:'rider_subsidy', categoryText:'骑手补贴', amount:50, note:'9月冲单奖励', createdByName:'系统管理员', updatedByName:'', createdAtMs:now-3*3600000, updatedAtMs:now-3*3600000 },
      { id:'LE1002', entryDate:mockDayOffset(0), direction:'expense', category:'flyer', categoryText:'传单印刷', amount:120, note:'开学季传单 500 份', createdByName:'客服小周', updatedByName:'', createdAtMs:now-5*3600000, updatedAtMs:now-5*3600000 },
      { id:'LE1003', entryDate:mockDayOffset(45), direction:'income', category:'other_income', categoryText:'其他收入', amount:300, note:'校外商家合作分成', createdByName:'系统管理员', updatedByName:'', createdAtMs:now-45*86400000, updatedAtMs:now-45*86400000 }
    ],
    settings:{ campusPrice:1, offCampusPrice:2, campusUrgentPrice:8, offCampusUrgentPrice:9, extraPiecePrice:1.5, largePrice:7, itemSmallCampusPrice:1, itemSmallOffCampusPrice:2, itemMediumCampusPrice:3, itemMediumOffCampusPrice:4, itemLargeCampusPrice:5, itemLargeOffCampusPrice:6, itemPricingVersion:2, itemUrgentFee:4, itemDoorFee:1, itemBuilding9Fee:0.5, itemUpperFloorDoorFee:1.5, bundleTier0Threshold:5, bundleTier0Discount:0.5, bundleTier1Threshold:10, bundleTier1Discount:1, bundleTier2Threshold:20, bundleTier2Discount:3, autoConfirmHours:12, observationHours:24, claimLimit:200, commissionRate:0, serviceStatus:'open', serviceNotice:'', reviewMode:false },
    auditLogs:[]
  }
}

// 与后端订单映射一致：接单后、取消/收入冻结/结算之前可以选择不划给骑手。
function normalizeMockOrder(order, riders, defaults = {}) {
  const source = { ...defaults, ...order }
  const rider = riders.find(item => source.riderId != null && String(item.id) === String(source.riderId)) || riders.find(item => item.name === source.riderName)
  const riderId = source.riderId ?? (source.riderName ? (rider?.id || `mock-rider-${source.riderName}`) : 0)
  const incomeFrozenAtMs = Number(source.incomeFrozenAtMs) || 0
  const settledAtMs = Number(source.settledAtMs) || 0
  return {
    ...source, riderId,
    riderName: rider?.nameNote || source.riderName || '',
    riderNickname: rider?.name || source.riderNickname || source.riderName || '',
    riderNameNote: rider?.nameNote || '',
    riderPhone: rider?.phone || source.riderPhone || '',
    riderIncome:Number(source.riderIncome ?? source.originalPrice) || 0,
    withholdRiderIncome:Boolean(source.withholdRiderIncome),
    incomeFrozenAtMs, settledAtMs,
    riderPayoutPending:Boolean(riderId) && source.status !== 'cancelled' && !incomeFrozenAtMs && !settledAtMs
  }
}

function readState() {
  const defaults = seedState()
  let state = defaults
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (parsed && typeof parsed === 'object') state = { ...defaults, ...parsed }
  } catch (error) {}
  const defaultOrders = new Map(defaults.orders.map(item => [item.id, item]))
  // 兼容旧 Mock 缓存：补齐新增字段，保留已经修改过的订单状态、扣留标记和其他演示数据。
  state.orders = state.orders.map(order => normalizeMockOrder(order, state.riders, defaultOrders.get(order.id)))
  return state
}

function writeState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

function wait() {
  return new Promise(resolve => window.setTimeout(resolve, 120 + Math.floor(Math.random() * 120)))
}

function audit(state, action, detail) {
  state.auditLogs.unshift({ id:`AL${Date.now()}`, action, detail, admin:'系统管理员', createdAtMs:Date.now() })
  state.auditLogs = state.auditLogs.slice(0, 100)
}

function pageResult(items, search) {
  const page = Math.max(1, Number(search.get('page')) || 1)
  const pageSize = Math.max(1, Math.min(100, Number(search.get('pageSize')) || 20))
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize }
}

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = 'XY'
  for (let index = 0; index < 8; index += 1) result += alphabet[Math.floor(Math.random() * alphabet.length)]
  return result
}

function mockAttachments(orderId) {
  if (orderId !== 'KD20260714000018') return []
  return [
    { id:'aabbccddeeff00112233445566778899', kind:'pickup', kindText:'取件截图', mimeType:'image/png', fileSize:48632, createdAtMs:Date.now()-40*60000, downloadName:`${orderId}-pickup-aabbccddeeff.png` },
    { id:'11223344556677889900aabbccddeeff', kind:'delivery', kindText:'送达凭证', mimeType:'image/png', fileSize:52218, createdAtMs:Date.now()-5*60000, downloadName:`${orderId}-delivery-112233445566.png` }
  ]
}

function mockImageBlob() {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const bytes = Uint8Array.from(window.atob(base64), character => character.charCodeAt(0))
  return new Blob([bytes], { type:'image/png' })
}

// 相对今天偏移 N 天的本地日期字符串（mock 跑在浏览器里，用户本地时区就是北京时间）
function mockDayOffset(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mockLedgerByDay(state) {
  const map = new Map()
  ;(state.ledgerEntries || []).forEach(entry => {
    const current = map.get(entry.entryDate) || { extraIncome:0, extraExpense:0 }
    if (entry.direction === 'income') current.extraIncome += Number(entry.amount) || 0
    else current.extraExpense += Number(entry.amount) || 0
    map.set(entry.entryDate, current)
  })
  return map
}

function mockLedgerCategoryText(category) {
  return LEDGER_CATEGORY_LABELS[category] || category
}

function mockLedgerDirection(category, fallback) {
  const preset = LEDGER_CATEGORIES.find(item => item.key === category)
  return preset ? preset.direction : fallback
}

// 与后端 GET /admin/dashboard/income 同构：订单日 ∪ 账目日，再补调整额与实际净收入。
function mockIncomePayload(state) {
  const orderDays = mockIncomeDays(40).reverse()
  const ledgerByDay = mockLedgerByDay(state)
  const byDay = new Map(orderDays.map(day => [day.date, { ...day }]))
  ledgerByDay.forEach((value, day) => {
    if (!byDay.has(day)) byDay.set(day, { date:day, orders:0, revenue:0, netRevenue:0 })
  })
  const days = [...byDay.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).map(day => {
    const base = byDay.get(day)
    const ledger = ledgerByDay.get(day) || { extraIncome:0, extraExpense:0 }
    const extraIncome = Math.round(ledger.extraIncome * 100) / 100
    const extraExpense = Math.round(ledger.extraExpense * 100) / 100
    const adjustment = Math.round((extraIncome - extraExpense) * 100) / 100
    return { ...base, extraIncome, extraExpense, adjustment, actualNetRevenue:Math.round((base.netRevenue + adjustment) * 100) / 100 }
  })
  const total = days.reduce((sum, day) => ({
    orders:sum.orders + day.orders, revenue:sum.revenue + day.revenue, netRevenue:sum.netRevenue + day.netRevenue,
    extraIncome:sum.extraIncome + day.extraIncome, extraExpense:sum.extraExpense + day.extraExpense
  }), { orders:0, revenue:0, netRevenue:0, extraIncome:0, extraExpense:0 })
  const roundedFields = ['revenue', 'netRevenue', 'extraIncome', 'extraExpense']
  roundedFields.forEach(key => { total[key] = Math.round(total[key] * 100) / 100 })
  total.adjustment = Math.round((total.extraIncome - total.extraExpense) * 100) / 100
  total.actualNetRevenue = Math.round((total.netRevenue + total.adjustment) * 100) / 100
  return { days, total, dayCount:days.length, categories:LEDGER_CATEGORIES, customCategoryKey:LEDGER_CUSTOM_CATEGORY }
}

// 造 count 天的逐日数据，返回按日期升序。净收入按 12% 抽成再减固定券成本，
// 于是在流水偏低的日子会自然出现负值——和生产「券单净亏」的情况一致。
function mockIncomeDays(count) {
  const base = new Date()
  const days = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const orders = Math.max(2, Math.round(16 + Math.sin(i * 0.9) * 7 + (count - 1 - i) * 0.6))
    const revenue = Math.round(orders * (2.4 + (i % 4) * 0.35) * 10) / 10
    const netRevenue = Math.round((revenue * 0.12 - 9.5) * 10) / 10
    days.push({ date, orders, revenue, netRevenue })
  }
  return days
}

export async function handleMockRequest(options) {
  await wait()
  const url = new URL(options.url, 'https://mock.local')
  const path = url.pathname
  const method = options.method
  const data = options.data || {}

  if (path === '/admin/auth/login' && method === 'POST') {
    if (String(data.username || '').trim() !== 'admin' || String(data.password || '') !== 'admin123') {
      throw new Error('账号或密码不正确')
    }
    return { token:'mock-admin-token', expiresAt:Date.now()+8*3600000, admin:{ id:'A1001', name:'系统管理员', roles:['super_admin'] } }
  }
  if (!String(options.headers.Authorization || '').startsWith('Bearer ')) throw new Error('请先登录管理台')

  const state = readState()
  if (path === '/admin/dashboard' && method === 'GET') {
    const todayStart = new Date().setHours(0,0,0,0)
    const todayOrders = state.orders.filter(item => item.createdAtMs >= todayStart)
    return {
      stats:{
        todayOrders:todayOrders.length,
        waiting:state.orders.filter(item=>item.status==='waiting').length,
        running:state.orders.filter(item=>['accepted','picked','delivering','delivered'].includes(item.status)).length,
        afterSales:state.afterSales.filter(item=>item.status!=='resolved').length,
        todayRevenue:todayOrders.reduce((sum,item)=>sum+Number(item.paidAmount||0),0),
        todayNetRevenue:Math.round(todayOrders.reduce((sum,item)=>sum+Number(item.paidAmount||0)-Number(item.riderIncome||0),0)*100)/100,
        pendingRiders:state.applications.filter(item=>item.status==='pending').length,
        pendingWithdrawals:state.withdrawals.filter(item=>item.status==='pending').length
      },
      recentOrders:state.orders.slice(0,6),
      pendingApplications:state.applications.filter(item=>item.status==='pending').slice(0,5)
    }
  }
  // 开发态造数据：净收入刻意做出正负交替，用于验证折线图负值可见（左轴下限）与净收入明细的正负着色。
  if (path === '/admin/dashboard/trend' && method === 'GET') {
    const days = mockIncomeDays(14).reverse()
    return { days }
  }
  if (path === '/admin/dashboard/income' && method === 'GET') return mockIncomePayload(state)
  if (path === '/admin/ledger-entries' && method === 'GET') {
    const sorted = [...(state.ledgerEntries || [])].sort((a, b) =>
      a.entryDate === b.entryDate ? Number(b.id.replace(/\D/g, '')) - Number(a.id.replace(/\D/g, '')) : (a.entryDate < b.entryDate ? 1 : -1))
    return { ...pageResult(sorted, url.searchParams), categories:LEDGER_CATEGORIES, customCategoryKey:LEDGER_CUSTOM_CATEGORY }
  }
  if (path === '/admin/ledger-entries' && method === 'POST') {
    const category = String(data.category || '')
    const isCustom = category === LEDGER_CUSTOM_CATEGORY
    const stored = isCustom ? String(data.customCategory || '').trim().slice(0, 32) : category
    if (!stored) throw new Error('请填写自定义类别名称')
    const entry = {
      id:`LE${Date.now()}`, entryDate:String(data.entryDate || mockDayOffset(0)),
      direction:mockLedgerDirection(stored, data.direction === 'income' ? 'income' : 'expense'),
      category:stored, categoryText:mockLedgerCategoryText(stored),
      amount:Math.round(Math.max(0.01, Number(data.amount) || 0) * 100) / 100,
      note:String(data.note || '').slice(0, 200),
      createdByName:'系统管理员', updatedByName:'', createdAtMs:Date.now(), updatedAtMs:Date.now()
    }
    state.ledgerEntries.unshift(entry)
    audit(state, '新增额外收支', `${entry.entryDate} ${entry.categoryText} ¥${entry.amount.toFixed(2)}`)
    writeState(state); return { item:entry }
  }
  const ledgerUpdateMatch = path.match(/^\/admin\/ledger-entries\/([^/]+)\/update$/)
  if (ledgerUpdateMatch && method === 'POST') {
    const entry = (state.ledgerEntries || []).find(record => record.id === decodeURIComponent(ledgerUpdateMatch[1]))
    if (!entry) throw new Error('账目不存在')
    const category = String(data.category || '')
    const isCustom = category === LEDGER_CUSTOM_CATEGORY
    const stored = isCustom ? String(data.customCategory || '').trim().slice(0, 32) : category
    if (!stored) throw new Error('请填写自定义类别名称')
    entry.entryDate = String(data.entryDate || entry.entryDate)
    entry.category = stored
    entry.categoryText = mockLedgerCategoryText(stored)
    entry.direction = mockLedgerDirection(stored, data.direction === 'income' ? 'income' : 'expense')
    entry.amount = Math.round(Math.max(0.01, Number(data.amount) || 0) * 100) / 100
    entry.note = String(data.note || '').slice(0, 200)
    entry.updatedByName = '系统管理员'
    entry.updatedAtMs = Date.now()
    audit(state, '修改额外收支', `${entry.entryDate} ${entry.categoryText} ¥${entry.amount.toFixed(2)}`)
    writeState(state); return { item:entry, updated:true }
  }
  const ledgerDeleteMatch = path.match(/^\/admin\/ledger-entries\/([^/]+)\/delete$/)
  if (ledgerDeleteMatch && method === 'POST') {
    const id = decodeURIComponent(ledgerDeleteMatch[1])
    const index = (state.ledgerEntries || []).findIndex(record => record.id === id)
    if (index < 0) throw new Error('账目不存在')
    const [entry] = state.ledgerEntries.splice(index, 1)
    audit(state, '删除额外收支', `${entry.entryDate} ${entry.categoryText} ¥${entry.amount.toFixed(2)}`)
    writeState(state); return { id, deleted:true }
  }
  if (path === '/admin/orders' && method === 'GET') {
    const keyword = String(url.searchParams.get('keyword') || '').toLowerCase()
    const status = String(url.searchParams.get('status') || '')
    const filtered = state.orders.filter(item => {
      const matchKeyword = !keyword || [item.id,item.contactName,item.phone,item.riderName,item.riderNickname,item.riderNameNote,item.riderPhone,item.building,item.room].some(value=>String(value||'').toLowerCase().includes(keyword))
      return matchKeyword && (!status || item.status === status)
    }).map(item => ({ ...item, attachmentCount:mockAttachments(item.id).length }))
    return pageResult(filtered, url.searchParams)
  }
  const withholdMatch = path.match(/^\/admin\/orders\/([^/]+)\/withhold-rider-income$/)
  if (withholdMatch && method === 'POST') {
    const order = state.orders.find(item => item.id === decodeURIComponent(withholdMatch[1]))
    if (!order) throw new Error('订单不存在')
    if (!order.riderId) throw new Error('该订单尚无骑手，无需设置')
    if (order.withholdRiderIncome) throw new Error('该订单已标记为不划给骑手')
    if (order.settledAtMs) throw new Error('该订单骑手收入已结算，无法再设置')
    if (order.incomeFrozenAtMs) throw new Error('该订单骑手收入已冻结，无法再设置')
    order.withholdRiderIncome = true
    audit(state, '订单不划给骑手', `${order.id} · ${order.riderName} · 骑手佣金 ¥${order.riderIncome.toFixed(2)}`)
    writeState(state)
    return { id:order.id, withholdRiderIncome:true }
  }
  const attachmentContentMatch = path.match(/^\/admin\/orders\/([^/]+)\/attachments\/([^/]+)$/)
  if (attachmentContentMatch && method === 'GET') {
    const orderId = decodeURIComponent(attachmentContentMatch[1])
    const attachmentId = decodeURIComponent(attachmentContentMatch[2])
    const item = mockAttachments(orderId).find(attachment => attachment.id === attachmentId)
    if (!item) throw new Error('图片不存在')
    audit(state, url.searchParams.get('download') === '1' ? '下载订单凭证' : '查看订单凭证', `${orderId} · ${item.kindText}`)
    writeState(state)
    return mockImageBlob()
  }
  const attachmentsMatch = path.match(/^\/admin\/orders\/([^/]+)\/attachments$/)
  if (attachmentsMatch && method === 'GET') {
    const orderId = decodeURIComponent(attachmentsMatch[1])
    if (!state.orders.some(item => item.id === orderId)) throw new Error('订单不存在')
    return { orderId, items:mockAttachments(orderId) }
  }
  if (path === '/admin/riders/overview' && method === 'GET') {
    // 与真后端一致：只回待审核的申请，已通过/已驳回的不出现在「待审核申请」面板。
    return { applications:state.applications.filter(item=>item.status==='pending'), riders:state.riders }
  }
  const reviewMatch = path.match(/^\/admin\/rider-applications\/([^/]+)\/review$/)
  if (reviewMatch && method === 'POST') {
    const application = state.applications.find(item=>item.id===decodeURIComponent(reviewMatch[1]))
    if (!application) throw new Error('申请记录不存在')
    application.status = data.approved ? 'approved' : 'rejected'
    application.statusText = data.approved ? '审核通过' : '审核未通过'
    application.reviewedAtMs = Date.now()
    if (data.approved && !state.riders.some(item=>item.phone===application.phone)) {
      state.riders.unshift({ id:`R${Date.now()}`, name:application.name, phone:application.phone, studentId:application.studentId, status:'approved', activeOrders:0, validOvertimes:0, historyOvertimes:0, availableBalance:0, frozenBalance:0, experiencePoints:0, riderLevel:1, riderLevelName:'新手骑手', maxActiveOrders:3 })
    }
    audit(state, data.approved?'通过骑手申请':'驳回骑手申请', `${application.name} ${application.phone}`)
    writeState(state)
    return application
  }
  const riderActionMatch = path.match(/^\/admin\/riders\/([^/]+)\/(restore|suspend)$/)
  if (riderActionMatch && method === 'POST') {
    const rider = state.riders.find(item=>item.id===decodeURIComponent(riderActionMatch[1]))
    if (!rider) throw new Error('骑手不存在')
    const action = riderActionMatch[2]
    rider.status = action === 'restore' ? 'approved' : 'suspended'
    if (action === 'restore') rider.validOvertimes = 0
    audit(state, action==='restore'?'恢复骑手资格':'暂停骑手资格', `${rider.name}：${String(data.reason||'未填写原因')}`)
    writeState(state)
    return rider
  }
  if (path === '/admin/after-sales' && method === 'GET') return { items:state.afterSales, total:state.afterSales.length }
  const afterSaleMatch = path.match(/^\/admin\/after-sales\/([^/]+)\/resolve$/)
  if (afterSaleMatch && method === 'POST') {
    const item = state.afterSales.find(record=>record.id===decodeURIComponent(afterSaleMatch[1]))
    if (!item) throw new Error('售后记录不存在')
    const compensation = Math.max(0, Math.min(200, Number(data.compensationAmount)||0))
    item.status='resolved';item.resolution=String(data.resolution||'客服处理完成');item.compensationAmount=compensation;item.resolvedAtMs=Date.now()
    audit(state,'完成售后处理',`${item.orderId}，赔付 ¥${compensation.toFixed(2)}`)
    writeState(state);return item
  }
  const afterSaleConvertMatch = path.match(/^\/admin\/after-sales\/([^/]+)\/convert-completed$/)
  if (afterSaleConvertMatch && method === 'POST') {
    const item = state.afterSales.find(record=>record.id===decodeURIComponent(afterSaleConvertMatch[1]))
    if (!item) throw new Error('售后记录不存在')
    item.status='resolved';item.resolution='正常完成，骑手无责';item.compensationAmount=0;item.resolvedAtMs=Date.now()
    audit(state,'转为正常完成',`${item.orderId}，骑手无责`)
    writeState(state);return item
  }
  if (path === '/admin/coupons/overview' && method === 'GET') return state.coupons
  if (path === '/admin/coupons/grants' && method === 'POST') {
    const amount=Math.max(.01,Number(data.amount)||0);const quantity=Math.max(1,Number(data.quantity)||1)
    const campaign={id:`CG${Date.now()}`,name:String(data.name||'平台活动券').slice(0,30),amount,minSpend:Math.max(0,Number(data.minSpend)||0),campus:String(data.campus||url.searchParams.get('campus')||'nanhai'),issued:quantity,used:0,status:'running'}
    state.coupons.campaigns.unshift(campaign);state.coupons.stats.total+=quantity;state.coupons.stats.available+=quantity
    audit(state,'发放优惠券',`${campaign.name}，${quantity}张`);writeState(state);return campaign
  }
  if (path === '/admin/coupon-codes' && method === 'POST') {
    const record={id:`CC${Date.now()}`,code:code(),name:String(data.name||'活动抵用券'),amount:Math.max(.01,Number(data.amount)||0),minSpend:Math.max(0,Number(data.minSpend)||0),expiresAtMs:Date.now()+Math.max(1,Number(data.validDays)||7)*86400000,status:'available'}
    state.coupons.codes.unshift(record);audit(state,'生成优惠券兑换码',record.code);writeState(state);return record
  }
  if (path === '/admin/withdrawals' && method === 'GET') return { items:state.withdrawals, total:state.withdrawals.length }
  const withdrawalMatch = path.match(/^\/admin\/withdrawals\/([^/]+)\/review$/)
  if (withdrawalMatch && method === 'POST') {
    const item=state.withdrawals.find(record=>record.id===decodeURIComponent(withdrawalMatch[1]));if(!item)throw new Error('提现记录不存在')
    item.status=data.approved?'paid':'rejected';item.reviewedAtMs=Date.now();item.reason=String(data.reason||'')
    audit(state,data.approved?'通过提现申请':'驳回提现申请',`${item.riderName} ¥${Number(item.amount).toFixed(2)}`);writeState(state);return item
  }
  if (path === '/admin/settings' && method === 'GET') return state.settings
  if (path === '/admin/settings/review-mode' && method === 'POST') {
    state.settings.reviewMode = data.enabled === true
    audit(state, state.settings.reviewMode ? '进入审核模式' : '退出审核模式', '整站开关')
    writeState(state)
    return { reviewMode:state.settings.reviewMode }
  }
  if (path === '/admin/settings/operational' && method === 'PUT') {
    const allowed=['autoConfirmHours','observationHours','claimLimit']
    allowed.forEach(key=>{if(Object.prototype.hasOwnProperty.call(data,key))state.settings[key]=data[key]})
    audit(state,'更新运营参数',`自动完成 ${state.settings.autoConfirmHours}h · 观察 ${state.settings.observationHours}h · 理赔上限 ¥${state.settings.claimLimit}`)
    writeState(state);return state.settings
  }
  if (path === '/admin/settings/service-status' && method === 'PUT') {
    const allowed=['serviceStatus','serviceNotice']
    allowed.forEach(key=>{if(Object.prototype.hasOwnProperty.call(data,key))state.settings[key]=data[key]})
    audit(state, state.settings.serviceStatus==='closed'?'停止服务':'恢复服务', String(state.settings.serviceNotice||''))
    writeState(state);return state.settings
  }
  if (path === '/admin/settings' && method === 'PUT') {
    const priceFields=['campusPrice','offCampusPrice','campusUrgentPrice','offCampusUrgentPrice','extraPiecePrice','largePrice','itemSmallCampusPrice','itemSmallOffCampusPrice','itemMediumCampusPrice','itemMediumOffCampusPrice','itemLargeCampusPrice','itemLargeOffCampusPrice','itemPricingVersion','itemUrgentFee','itemDoorFee','itemBuilding9Fee','itemUpperFloorDoorFee','bundleTier0Threshold','bundleTier0Discount','bundleTier1Threshold','bundleTier1Discount','bundleTier2Threshold','bundleTier2Discount','commissionRate']
    const priceChanged=priceFields.some(key=>Object.prototype.hasOwnProperty.call(data,key)&&Number(data[key])!==Number(state.settings[key]))
    if(priceChanged)throw new Error('正式价格随小程序版本发布，不能在管理台单独修改')
    const allowed=['autoConfirmHours','observationHours','claimLimit','serviceStatus','serviceNotice']
    allowed.forEach(key=>{if(Object.prototype.hasOwnProperty.call(data,key))state.settings[key]=data[key]})
    audit(state,'更新平台设置','已保存正式业务参数');writeState(state);return state.settings
  }
  throw new Error(`Mock API 未实现：${method} ${path}`)
}
