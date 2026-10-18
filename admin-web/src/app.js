import { adminApi } from './api.js'
import { config, environmentLabel } from './config.js'
import { clearSession, readSession, saveSession } from './session.js'
import { dateTime, escapeHtml, money, sizeSummary, statusPill } from './format.js'
import { campusLabel, effectiveCampus, isBoss, selectCampus, CAMPUSES } from './campus.js'

const viewMeta = {
  overview:['OVERVIEW','运营概览'], income:['INCOME','净收入明细'], orders:['ORDERS','订单管理'], riders:['RIDERS','骑手管理'],
  afterSales:['AFTER SALES','售后理赔'], feedbacks:['FEEDBACK','意见反馈'], coupons:['COUPONS','优惠券运营'], finance:['FINANCE','提现审核'], settings:['SETTINGS','平台设置']
}
const menuAccess = {
  overview:['operator','customer_service','finance','auditor'],
  income:['operator','customer_service','finance','auditor'],
  orders:['operator','customer_service','finance','auditor'],
  riders:['operator','auditor'],
  afterSales:['operator','customer_service','auditor'],
  feedbacks:['operator','customer_service','auditor'],
  coupons:['operator','auditor'],
  finance:['finance','auditor'],
  settings:['admin','auditor']
}
function currentRoles() {
  return Array.isArray(session?.admin?.roles) ? session.admin.roles : []
}
function hasAnyRole(...allowed) {
  const roles = currentRoles()
  return roles.includes('super_admin') || roles.some(role => allowed.includes(role))
}
function canAccessView(view) {
  const allowed = menuAccess[view]
  return Boolean(allowed) && hasAnyRole(...allowed)
}
function applyMenuVisibility() {
  elements.navList.querySelectorAll('button[data-view]').forEach(button => {
    button.hidden = !canAccessView(button.dataset.view)
  })
}
const elements = {
  loginScreen:document.querySelector('#loginScreen'), loginForm:document.querySelector('#loginForm'),
  mockCredential:document.querySelector('#mockCredential'), adminApp:document.querySelector('#adminApp'),
  navList:document.querySelector('#navList'), pageContent:document.querySelector('#pageContent'),
  viewEyebrow:document.querySelector('#viewEyebrow'), viewTitle:document.querySelector('#viewTitle'),
  environmentBadge:document.querySelector('#environmentBadge'), adminName:document.querySelector('#adminName'),
  campusSwitcher:document.querySelector('#campusSwitcher'), adminCampusLabel:document.querySelector('#adminCampusLabel'),
  logoutButton:document.querySelector('#logoutButton'),
  toast:document.querySelector('#toast'), menuButton:document.querySelector('#menuButton'),
  mobileMask:document.querySelector('#mobileMask'), offlineNotice:document.querySelector('#offlineNotice'),
  attachmentModal:document.querySelector('#attachmentModal'), attachmentTitle:document.querySelector('#attachmentTitle'),
  attachmentCloseButton:document.querySelector('#attachmentCloseButton'), attachmentList:document.querySelector('#attachmentList'),
  themeToggle:document.querySelector('#themeToggle')
}
let session = readSession()
let currentView = 'overview'
let toastTimer = 0
let attachmentRequestToken = 0
let attachmentOrderId = ''

function toast(message, type='success') {
  window.clearTimeout(toastTimer)
  elements.toast.textContent = String(message || '操作完成')
  elements.toast.className = `toast show ${type === 'error' ? 'error' : ''}`
  toastTimer = window.setTimeout(() => { elements.toast.className = 'toast' }, 2400)
}

function errorMessage(error) {
  toast(error && error.message ? error.message : '操作失败，请稍后重试', 'error')
}

function canViewOrderAttachments() {
  const roles = Array.isArray(session?.admin?.roles) ? session.admin.roles : []
  return roles.includes('super_admin') || roles.some(role => ['operator','customer_service','auditor'].includes(role))
}

function fileSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

function closeAttachmentModal() {
  attachmentRequestToken += 1
  attachmentOrderId = ''
  elements.attachmentModal.hidden = true
  elements.attachmentList.innerHTML = ''
  document.body.classList.remove('modal-open')
}

async function openOrderAttachments(orderId) {
  if (!canViewOrderAttachments()) throw new Error('当前账号没有查看订单凭证的权限')
  attachmentRequestToken += 1
  const requestToken = attachmentRequestToken
  attachmentOrderId = String(orderId || '')
  elements.attachmentTitle.textContent = `订单 ${attachmentOrderId} 凭证`
  elements.attachmentList.innerHTML = '<div class="loading-box">正在读取凭证列表</div>'
  elements.attachmentModal.hidden = false
  document.body.classList.add('modal-open')
  try {
    const data = await adminApi.orderAttachments(attachmentOrderId)
    if (requestToken !== attachmentRequestToken) return
    const items = Array.isArray(data.items) ? data.items : []
    if (!items.length) {
      elements.attachmentList.innerHTML = '<div class="empty-box">该订单没有已关联凭证</div>'
      return
    }
    elements.attachmentList.innerHTML = items.map((item, index) => `
      <article class="attachment-item">
        <strong>${escapeHtml(item.kindText || (item.kind === 'delivery' ? '送达凭证' : '取件截图'))} ${index + 1}</strong>
        <span>${escapeHtml(fileSize(item.fileSize))} · ${dateTime(item.createdAtMs)}</span>
        <div class="attachment-item-actions">
          <button class="secondary-button" type="button" data-action="download-attachment" data-id="${escapeHtml(item.id)}" data-filename="${escapeHtml(item.downloadName || 'order-attachment.jpg')}">下载</button>
        </div>
      </article>`).join('')
  } catch (error) {
    if (requestToken === attachmentRequestToken) elements.attachmentList.innerHTML = '<div class="empty-box">凭证列表读取失败</div>'
    throw error
  }
}

async function readOrderAttachment(target) {
  if (!attachmentOrderId) return
  const attachmentId = String(target.dataset.id || '')
  if (!attachmentId) return
  target.disabled = true
  try {
    const blob = await adminApi.orderAttachment(attachmentOrderId, attachmentId, true)
    if (!blob || !String(blob.type || '').startsWith('image/')) throw new Error('服务器返回的凭证格式不正确')
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = String(target.dataset.filename || 'order-attachment.jpg')
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    toast('凭证已下载，本次操作已记录')
  } finally {
    target.disabled = false
  }
}

function showLogin() {
  closeAttachmentModal()
  session = null
  elements.loginScreen.hidden = false
  elements.adminApp.hidden = true
  elements.loginForm.reset()
}

function currentCampus() {
  return effectiveCampus(session?.admin)
}

function renderCampusChrome() {
  const boss = isBoss(session?.admin)
  const campus = currentCampus()
  elements.campusSwitcher.hidden = !boss
  elements.campusSwitcher.querySelectorAll('button[data-campus]').forEach(button => {
    button.classList.toggle('active', button.dataset.campus === campus)
  })
  elements.adminCampusLabel.textContent = campusLabel(campus)
}

// 校区切换器按 CAMPUSES 数组驱动，新增校区无需改模板。
function initCampusSwitcher() {
  elements.campusSwitcher.innerHTML = CAMPUSES.map(campus =>
    `<button type="button" data-campus="${campus}">${escapeHtml(campusLabel(campus))}</button>`
  ).join('')
}

function showAdmin() {
  elements.loginScreen.hidden = true
  elements.adminApp.hidden = false
  elements.adminName.textContent = session?.admin?.name || '管理员'
  elements.environmentBadge.textContent = environmentLabel()
  renderCampusChrome()
  applyMenuVisibility()
  if (!canAccessView(currentView)) currentView = 'overview'
  switchView(currentView)
}

function pageHeading(title, description, actions='') {
  return `<div class="page-heading"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div><div class="action-row">${actions}</div></div>`
}

function statCard(label, value, detail, tone='') {
  return `<article class="stat-card ${tone}"><span class="stat-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`
}

function emptyRow(columns, message='暂无数据') {
  return `<tr><td colspan="${columns}"><div class="empty-box">${escapeHtml(message)}</div></td></tr>`
}

const refundLabels={pending:'退款待处理',processing:'退款处理中',succeeded:'退款已完成',retryable:'退款等待重试',manual_review:'退款需人工核对'}
function refundLine(item){const label=refundLabels[item?.refundStatus]||'';if(!label)return'';const error=item.refundLastError?`<span class="cell-sub" title="${escapeHtml(item.refundLastError)}">${escapeHtml(item.refundLastError)}</span>`:'';return`<span class="cell-sub">${escapeHtml(label)}${item.refundAmount?` · ¥${money(item.refundAmount)}`:''}</span>${error}`}

function renderLoading() {
  elements.pageContent.innerHTML = '<div class="loading-box">正在加载数据</div>'
}

function niceCeil(value) {
  if (value <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * magnitude
}

function fmtAxis(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function renderTrendChart(days) {
  const data = (Array.isArray(days) ? days : []).slice(-14)
  if (!data.length) return '<div class="empty-box">暂无趋势数据</div>'
  const W = 800, H = 300
  const padL = 46, padR = 40, padT = 16, padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const n = data.length
  const revenue = data.map(d => Number(d.revenue) || 0)
  const net = data.map(d => Number(d.netRevenue) || 0)
  const orders = data.map(d => Number(d.orders) || 0)
  // 左轴必须容纳负值：净收入长期为负（平台发券补贴），只从 0 起算会把负值画到绘图区下方，
  // 表现为「折线图最下面被盖住、看不到实际负收益」。故下限在有负值时向下取整到整刻度。
  const maxLeft = niceCeil(Math.max(...revenue, ...net, 1))
  const minRaw = Math.min(0, ...revenue, ...net)
  const minLeft = minRaw < 0 ? -niceCeil(-minRaw) : 0
  const spanLeft = maxLeft - minLeft
  const maxRight = niceCeil(Math.max(...orders, 1))
  const xAt = i => padL + (n === 1 ? plotW / 2 : i * plotW / (n - 1))
  const yLeft = v => padT + plotH - (v - minLeft) / spanLeft * plotH
  const yRight = v => padT + plotH - v / maxRight * plotH

  let grid = ''
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH * g / 4
    const leftVal = maxLeft - spanLeft * g / 4
    const rightVal = maxRight - maxRight * g / 4
    grid += `<line class="trend-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>`
    grid += `<text class="trend-axis" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">¥${fmtAxis(leftVal)}</text>`
    grid += `<text class="trend-axis" x="${W - padR + 6}" y="${(y + 3).toFixed(1)}">${fmtAxis(rightVal)}</text>`
  }

  const linePath = (values, yFn) => values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)} ${yFn(v).toFixed(1)}`).join(' ')
  const dots = (values, yFn, cls, label) => values.map((v, i) =>
    `<circle class="${cls}" cx="${xAt(i).toFixed(1)}" cy="${yFn(v).toFixed(1)}" r="3.5"><title>${data[i].date} ${label} ¥${money(v)}</title></circle>`).join('')
  const orderDots = orders.map((v, i) =>
    `<circle class="trend-dot-orders" cx="${xAt(i).toFixed(1)}" cy="${yRight(v).toFixed(1)}" r="3.5"><title>${data[i].date} ${v} 单</title></circle>`).join('')

  let xLabels = ''
  data.forEach((d, i) => {
    if (i % 2 !== 0) return
    xLabels += `<text class="trend-axis" x="${xAt(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${d.date.slice(5)}</text>`
  })

  // 有负值时补一条 0 基准线，否则无法直观判断折线是盈利还是亏损
  const zeroLine = minLeft < 0
    ? `<line class="trend-zero" x1="${padL}" y1="${yLeft(0).toFixed(1)}" x2="${W - padR}" y2="${yLeft(0).toFixed(1)}"/>`
    : ''

  return `<svg class="trend-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="近14天营收与订单数趋势">
    ${grid}
    ${zeroLine}
    <path class="trend-line-revenue" d="${linePath(revenue, yLeft)}"/>
    <path class="trend-line-net" d="${linePath(net, yLeft)}"/>
    <path class="trend-line-orders" d="${linePath(orders, yRight)}"/>
    ${dots(revenue, yLeft, 'trend-dot-revenue', '流水')}
    ${dots(net, yLeft, 'trend-dot-net', '净收入')}
    ${orderDots}
    ${xLabels}
  </svg>`
}

async function renderOverview() {
  const campus = currentCampus()
  const data = await adminApi.dashboard(campus)
  const trend = await adminApi.trend(campus)
  const stats = data.stats || {}
  elements.pageContent.innerHTML = `
    ${pageHeading('运营概览','查看今天的订单、骑手审核、售后和资金处理情况。','<button class="secondary-button" data-action="refresh">刷新数据</button>')}
    <section class="stats-grid">
      ${statCard('今日订单',stats.todayOrders||0,`实收 ¥${money(stats.todayRevenue)}`)}
      ${statCard('今日净收入',`¥${money(stats.todayNetRevenue)}`,'已含今日额外收支 · 折线图为订单口径',Number(stats.todayNetRevenue)<0?'warning':'success')}
      ${statCard('待骑手接单',stats.waiting||0,'请关注长时间无人接单','warning')}
      ${statCard('配送进行中',stats.running||0,'已接单至待用户确认','success')}
      ${statCard('待处理售后',stats.afterSales||0,'理赔上限 ¥200','danger')}
    </section>
    <article class="panel trend-panel">
      <div class="panel-header"><h4>近 14 天趋势</h4><span>每日订单数与营收（左轴金额 · 右轴订单数）</span></div>
      <div class="panel-body trend-body">
        <div class="trend-legend">
          <span class="trend-key"><i class="trend-swatch revenue"></i>订单流水</span>
          <span class="trend-key"><i class="trend-swatch net"></i>净收入（订单口径）</span>
          <span class="trend-key"><i class="trend-swatch orders"></i>订单数（右轴）</span>
        </div>
        ${renderTrendChart(trend.days)}
      </div>
    </article>
    <section class="content-grid">
      <article class="panel"><div class="panel-header"><h4>最近订单</h4><span>按创建时间排序</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>订单</th><th>送达地址</th><th>骑手</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${(data.recentOrders||[]).map(item=>`<tr><td><span class="cell-main">${escapeHtml(item.id)}</span><span class="cell-sub">${escapeHtml(item.contactName)} · ${dateTime(item.createdAtMs)}</span></td><td>${escapeHtml(item.building+item.room)}<span class="cell-sub">${sizeSummary(item)}</span></td><td>${escapeHtml(item.riderName||'待接单')}</td><td class="price-cell">¥${money(item.paidAmount)}</td><td>${statusPill(item.status,item.statusText)}${refundLine(item)}</td><td>-</td></tr>`).join('')||emptyRow(6)}
      </tbody></table></div></article>
      <article class="panel"><div class="panel-header"><h4>待办事项</h4><span>需要管理员处理</span></div><div class="panel-body quick-list">
        <div class="quick-item"><div><strong>骑手申请</strong><span>审核姓名、学号和手机号</span></div><strong>${stats.pendingRiders||0}</strong></div>
        <div class="quick-item"><div><strong>提现申请</strong><span>核对观察期和可提现余额</span></div><strong>${stats.pendingWithdrawals||0}</strong></div>
        <div class="quick-item"><div><strong>售后理赔</strong><span>完成后保留处理记录</span></div><strong>${stats.afterSales||0}</strong></div>
        <div class="quick-item"><div><strong>退款核对</strong><span>等待重试或需要人工确认</span></div><strong>${stats.refundAttention||0}</strong></div>
      </div></article>
    </section>`
}

// 记账表单状态。整页每次重渲染都会重建 DOM，所以「表单开着没、在编辑哪一条」只能存在模块变量里。
let ledgerForm = { open:false, id:'', entryDate:'', category:'', customCategory:'', direction:'expense', amount:'', note:'' }
let ledgerPage = 1
const LEDGER_PAGE_SIZE = 50

function emptyLedgerForm() {
  return { open:false, id:'', entryDate:'', category:'', customCategory:'', direction:'expense', amount:'', note:'' }
}

function canManageLedger() {
  return hasAnyRole('operator','customer_service')
}

// 北京今天的 YYYY-MM-DD。不能用 new Date().toISOString()——那是 UTC 日期，
// 北京时间 00:00–08:00 期间会比北京日期小一天。
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function truncate(value, max) {
  const text = String(value == null ? '' : value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}

// 净收入明细：列出「产生过订单」或「记过账」的北京自然日 + 合计。
// 「净收入」列是纯订单口径，与「近 14 天趋势」完全一致（后端 GET /admin/dashboard/income）；
// 「实际净收入」= 净收入 + 手工登记的额外收支。区别是不限 14 天、不补空日。
async function renderIncome() {
  const campus = currentCampus()
  const [data, ledger] = await Promise.all([
    adminApi.income(campus),
    adminApi.ledgerEntries({ page:ledgerPage, pageSize:LEDGER_PAGE_SIZE }, campus)
  ])
  const days = data.days || []
  const total = data.total || { orders:0, revenue:0, netRevenue:0, couponLoss:0, extraIncome:0, extraExpense:0, adjustment:0, actualNetRevenue:0 }
  const entries = ledger.items || []
  const categories = Array.isArray(ledger.categories) ? ledger.categories : []
  const customCategoryKey = ledger.customCategoryKey || 'custom'
  const presetKeys = new Set(categories.map(item => item.key))
  const entryTotal = Number(ledger.total) || 0
  const totalPages = Math.max(1, Math.ceil(entryTotal / LEDGER_PAGE_SIZE))
  const riderIncome = day => day.revenue - day.netRevenue
  const netCell = value => `<td class="price-cell ${value<0?'negative':'positive'}">¥${money(value)}</td>`
  // 没有额外收支的日子显式显示破折号，避免和「记过一笔 0 元」混淆
  const extraCell = day => {
    if (!day.extraIncome && !day.extraExpense) return '<td class="price-cell">—</td>'
    const lines = []
    if (day.extraIncome) lines.push(`<span class="cell-sub">收 ¥${money(day.extraIncome)}</span>`)
    if (day.extraExpense) lines.push(`<span class="cell-sub">支 ¥${money(day.extraExpense)}</span>`)
    lines.push(`<span class="cell-sub">${Number(day.adjustment)<0?'−':'+'}¥${money(Math.abs(Number(day.adjustment)||0))}</span>`)
    return `<td class="price-cell stacked">${lines.join('')}</td>`
  }
  const editable = canManageLedger()
  const formOpen = editable && ledgerForm.open
  const formEntryDate = ledgerForm.entryDate || beijingToday()
  const actionButtons = `${editable?`<button class="primary-button" data-action="open-ledger-form">记一笔</button>`:''}<button class="secondary-button" data-action="refresh">刷新数据</button>`
  elements.pageContent.innerHTML = `
    ${pageHeading('净收入明细','按北京自然日汇总，列出产生过订单或记过账的日期。净收入 = 订单流水 − 骑手收入 = 抽成利润 − 优惠券支出；实际净收入 = 净收入 + 额外收支。',actionButtons)}
    <section class="stats-grid">
      ${statCard('累计实际净收入',`¥${money(total.actualNetRevenue)}`,`订单口径 ¥${money(total.netRevenue)} · 共 ${days.length} 天`,Number(total.actualNetRevenue)<0?'warning':'success')}
      ${statCard('累计额外收支',`¥${money(total.adjustment)}`,`收入 ¥${money(total.extraIncome)} · 支出 ¥${money(total.extraExpense)}`,Number(total.adjustment)<0?'warning':'success')}
      ${statCard('累计订单流水',`¥${money(total.revenue)}`,'用户实付合计（不含已取消）')}
      ${statCard('累计订单数',total.orders||0,'不含已取消订单')}
    </section>
    ${formOpen?`<article class="panel spaced-panel">
      <div class="panel-header"><h4>${ledgerForm.id?'编辑账目':'记一笔额外收支'}</h4><span>${ledgerForm.id?`正在编辑账目 ${escapeHtml(ledgerForm.id)}`:'骑手补贴、传单印刷等订单之外的收支'}</span></div>
      <div class="panel-body">
        <form id="ledgerEntryForm" class="form-grid">
          <label>记账日期<input name="entryDate" type="date" required min="2020-01-01" max="${beijingToday()}" value="${escapeHtml(formEntryDate)}"></label>
          <label>收支类别<select name="category" id="ledgerCategory">${categories.map(item=>`<option value="${escapeHtml(item.key)}" ${ledgerForm.category===item.key?'selected':''}>${escapeHtml(item.label)}</option>`).join('')}<option value="${escapeHtml(customCategoryKey)}" ${ledgerForm.category===customCategoryKey?'selected':''}>自定义</option></select></label>
          <div class="full-field" id="ledgerCustomFields">
            <div class="form-grid">
              <label>自定义类别名称<input name="customCategory" maxlength="32" placeholder="例如：校园代理佣金" value="${escapeHtml(ledgerForm.customCategory)}"></label>
              <label>收支方向<select name="direction"><option value="expense" ${ledgerForm.direction!=='income'?'selected':''}>支出（亏损）</option><option value="income" ${ledgerForm.direction==='income'?'selected':''}>收入</option></select></label>
            </div>
          </div>
          <label>金额（元）<input name="amount" type="number" min="0.01" max="99999999.99" step="0.01" required placeholder="0.00" value="${escapeHtml(ledgerForm.amount)}"></label>
          <label>备注<input name="note" maxlength="200" placeholder="选填，例如：9月骑手冲单奖励" value="${escapeHtml(ledgerForm.note)}"></label>
          <button class="primary-button" type="submit">${ledgerForm.id?'保存修改':'确认记账'}</button>
          <button class="secondary-button" type="button" data-action="close-ledger-form">取消</button>
        </form>
        <div class="settings-note">预设类别自带收支方向（例如「骑手补贴」固定为支出），方向由服务端判定，不能在这里改；只有「自定义」类别才由你指定方向。记账只影响本页的「实际净收入」，不改订单金额、不进入骑手结算。</div>
      </div>
    </article>`:''}
    <article class="panel${formOpen?' spaced-panel':''}">
      <div class="panel-header"><h4>逐日净收入</h4><span>按日期倒序</span></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>订单数</th><th>订单流水</th><th>骑手收入</th><th>净收入</th><th>优惠券损失</th><th>额外收支</th><th>实际净收入</th></tr></thead><tbody>
      ${days.map(day=>`<tr><td><span class="cell-main">${escapeHtml(day.date)}</span></td><td>${day.orders||0}</td><td class="price-cell">¥${money(day.revenue)}</td><td class="price-cell">${day.orders?`¥${money(riderIncome(day))}`:'—'}</td>${netCell(day.netRevenue)}<td class="price-cell">${day.couponLoss?`¥${money(day.couponLoss)}`:'—'}</td>${extraCell(day)}${netCell(day.actualNetRevenue)}</tr>`).join('')||emptyRow(8)}
      </tbody><tfoot><tr><td>合计</td><td>${total.orders||0}</td><td class="price-cell">¥${money(total.revenue)}</td><td class="price-cell">¥${money(riderIncome(total))}</td>${netCell(total.netRevenue)}<td class="price-cell">${total.couponLoss?`¥${money(total.couponLoss)}`:'—'}</td><td class="price-cell">${Number(total.adjustment)<0?'−':'+'}¥${money(Math.abs(Number(total.adjustment)||0))}</td>${netCell(total.actualNetRevenue)}</tr></tfoot></table></div>
    </article>
    <article class="panel spaced-panel">
      <div class="panel-header"><h4>额外收支明细</h4><span>共 ${entryTotal} 条 · 第 ${Math.min(ledgerPage,totalPages)}/${totalPages} 页</span>
        <div class="table-actions">
          <button class="secondary-button" type="button" data-action="ledger-prev" ${ledgerPage<=1?'disabled':''}>上一页</button>
          <button class="secondary-button" type="button" data-action="ledger-next" ${ledgerPage>=totalPages?'disabled':''}>下一页</button>
        </div>
      </div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>类别</th><th>方向</th><th>金额</th><th>备注</th><th>记录人</th><th>操作</th></tr></thead><tbody>
      ${entries.map(item=>{
        const custom = !presetKeys.has(item.category)
        return `<tr><td><span class="cell-main">${escapeHtml(item.entryDate)}</span></td><td>${escapeHtml(item.categoryText||item.category)}</td><td><span class="status-pill ${item.direction==='income'?'green':'orange'}">${escapeHtml(item.directionText||(item.direction==='income'?'收入':'支出'))}</span></td><td class="price-cell ${item.direction==='income'?'positive':'negative'}">${item.direction==='income'?'+':'−'}¥${money(item.amount)}</td><td title="${escapeHtml(item.note)}">${escapeHtml(truncate(item.note,36))||'—'}</td><td>${escapeHtml(item.updatedByName||item.createdByName||'—')}</td><td><div class="table-actions">${editable?`<button class="secondary-button" data-action="edit-ledger-entry" data-id="${escapeHtml(item.id)}" data-date="${escapeHtml(item.entryDate)}" data-category="${escapeHtml(custom?customCategoryKey:item.category)}" data-custom="${escapeHtml(custom?item.category:'')}" data-direction="${escapeHtml(item.direction)}" data-amount="${escapeHtml(money(item.amount))}" data-note="${escapeHtml(item.note)}">编辑</button><button class="danger-button" data-action="delete-ledger-entry" data-id="${escapeHtml(item.id)}" data-summary="${escapeHtml(`${item.entryDate} ${item.categoryText||item.category} ¥${money(item.amount)}`)}">删除</button>`:'仅可查看'}</div></td></tr>`
      }).join('')||emptyRow(7,'还没有额外收支记录')}
      </tbody></table></div>
      ${editable?'':'<div class="panel-body"><div class="settings-note">当前账号可以查看账目，但只有运营和客服账号能新增、编辑或删除。</div></div>'}
    </article>`
  const categorySelect = document.querySelector('#ledgerCategory')
  if (categorySelect) {
    const customFields = document.querySelector('#ledgerCustomFields')
    // 用内联 display 而不是 hidden 属性：.form-grid label{display:block} 是作者样式，
    // 优先级高于浏览器默认的 [hidden]{display:none}，加 hidden 属性根本藏不住。
    const syncCustomFields = () => { customFields.style.display = categorySelect.value === customCategoryKey ? '' : 'none' }
    categorySelect.addEventListener('change', syncCustomFields)
    syncCustomFields()
  }
  document.querySelector('#ledgerEntryForm')?.addEventListener('submit', submitLedgerEntry)
}

async function submitLedgerEntry(event) {
  event.preventDefault()
  const form = new FormData(event.currentTarget)
  const button = event.currentTarget.querySelector('button[type="submit"]')
  const payload = {
    entryDate: String(form.get('entryDate')||''),
    category: String(form.get('category')||''),
    customCategory: String(form.get('customCategory')||''),
    direction: String(form.get('direction')||''),
    amount: String(form.get('amount')||''),
    note: String(form.get('note')||'')
  }
  // 客户端先挡一道：失败时表单内容不丢。服务端会再校验一次，以服务端为准。
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.entryDate)) { toast('请选择记账日期','error'); return }
  if (payload.entryDate > beijingToday()) { toast('记账日期不能晚于今天','error'); return }
  const amount = Number(payload.amount)
  if (!Number.isFinite(amount)||amount<0.01||amount>99999999.99) { toast('金额必须在 0.01—99999999.99 元之间','error'); return }
  if (payload.category==='custom'&&!payload.customCategory.trim()) { toast('请填写自定义类别名称','error'); return }
  const editingId = ledgerForm.id
  // requireIdempotency 挡不住双击：每次请求都会新生成一个 Idempotency-Key，两次点击就是两条账。
  button.disabled = true
  try {
    if (editingId) await adminApi.updateLedgerEntry(editingId, payload, currentCampus())
    else await adminApi.createLedgerEntry(payload, currentCampus())
    ledgerForm = emptyLedgerForm()
    ledgerPage = 1
    toast(editingId?'账目已更新':'已记账，实际净收入已同步')
    switchView('income')
  } catch (error) {
    errorMessage(error)
  } finally {
    button.disabled = false
  }
}

async function renderOrders(filters={}) {
  const data = await adminApi.orders({ page:1, pageSize:50, ...filters }, currentCampus())
  const allowAttachments = canViewOrderAttachments()
  elements.pageContent.innerHTML = `
    ${pageHeading('订单管理','按订单号、用户、手机号或骑手搜索全部订单。','<button class="secondary-button" data-action="refresh">刷新</button>')}
    <article class="panel"><div class="panel-body">
      <form id="orderFilter" class="toolbar"><label>搜索<input name="keyword" value="${escapeHtml(filters.keyword||'')}" placeholder="订单号 / 姓名 / 手机号"></label><label>订单状态<select name="status"><option value="">全部状态</option>${[['unpaid','待支付'],['waiting','待接单'],['accepted','已接单'],['picked','已取件'],['delivering','配送中'],['delivered','待确认'],['completed','已完成'],['cancelled','已取消'],['disputed','售后中']].map(([value,label])=>`<option value="${value}" ${filters.status===value?'selected':''}>${label}</option>`).join('')}</select></label><button class="primary-button" type="submit">查询</button><button class="ghost-button" type="button" data-action="reset-orders">重置</button></form>
    </div><div class="table-wrap"><table class="data-table"><thead><tr><th>订单信息</th><th>用户</th><th>送货地址</th><th>骑手</th><th>价格</th><th>创建时间</th><th>最晚交付</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${(data.items||[]).map(item=>`<tr><td><span class="cell-main">${escapeHtml(item.id)}</span><span class="cell-sub">${sizeSummary(item)} · ${escapeHtml(item.urgencyText||item.urgency)}</span>${item.pickupScopeText?`<span class="status-pill ${item.pickupScope==='mixed'?'orange':(item.pickupScope==='off_campus'?'red':'green')}">${escapeHtml(item.pickupScopeText)}</span>`:''}</td><td>${escapeHtml(item.contactName)}<span class="cell-sub">${escapeHtml(item.phone)}</span></td><td class="price-cell stacked"><span class="cell-sub">${escapeHtml(item.building+item.room)}${item.buildingGenderText?` <span class="status-pill ${item.buildingGender==='female'?'red':item.buildingGender==='mixed'?'orange':''}">${escapeHtml(item.buildingGenderText)}</span>`:''}</span><span class="cell-sub">${item.noUpstairs?'不送上楼':'送上楼'}</span></td><td class="price-cell stacked"><span class="cell-sub">${escapeHtml(item.riderName||'待接单')}</span><span class="cell-sub">${escapeHtml(item.riderPhone||'—')}</span></td><td class="price-cell stacked"><span class="cell-sub">实付 ¥${money(item.paidAmount)}</span><span class="cell-sub">原价 ¥${money(item.originalPrice)}</span><span class="cell-sub">骑手佣金 ¥${money(item.riderIncome)}</span></td><td>${dateTime(item.createdAtMs)}</td><td>${item.urgency==='urgent'?'接单后 1 小时':(item.deadlineAtMs?dateTime(item.deadlineAtMs):'—')}</td><td>${statusPill(item.status,item.statusText)}${refundLine(item)}</td><td><div class="table-actions">${item.withholdRiderIncome?`<span class="status-pill orange">未划给骑手</span>`:(item.riderPayoutPending?`<button class="danger-button" data-action="withhold-rider-income" data-id="${escapeHtml(item.id)}" data-rider="${escapeHtml(item.riderName||'')}">不划给骑手</button>`:'')}${Number(item.attachmentCount)>0?(allowAttachments?`<button class="secondary-button" data-action="view-order-attachments" data-id="${escapeHtml(item.id)}">查看凭证（${Number(item.attachmentCount)}）</button>`:'受限'):''}${!['completed','cancelled'].includes(item.status)?`<button class="danger-button" data-action="cancel-order" data-id="${escapeHtml(item.id)}" data-paid="${Number(item.paidAmount)||0}">取消订单</button>`:''}</div></td></tr>`).join('')||emptyRow(9)}
    </tbody></table></div></article>`
  document.querySelector('#orderFilter')?.addEventListener('submit', event => {
    event.preventDefault();const form=new FormData(event.currentTarget);const statusValue=String(form.get('status')||'');renderViewWith(()=>renderOrders({keyword:String(form.get('keyword')||'').trim(),status:statusValue}))
  })
}

function matchRider(item, keyword) {
  if (!keyword) return true
  const needle = keyword.toLowerCase()
  return [item.name, item.studentId, item.phone].some(value => String(value||'').toLowerCase().includes(needle))
}

async function renderRiders(filters={}) {
  const data = await adminApi.riderOverview(currentCampus())
  const keyword = String(filters.keyword||'').trim()
  const allRiders = data.riders||[]
  const riders = allRiders.filter(item => matchRider(item, keyword))
  elements.pageContent.innerHTML = `
    ${pageHeading('骑手管理','审核新骑手申请，查看等级、经验、接单上限和超时记录；骑手名单支持按姓名、学号、手机号搜索。','<button class="secondary-button" data-action="refresh">刷新</button>')}
    <article class="panel"><div class="panel-header"><h4>待审核申请</h4><span>${(data.applications||[]).length} 条待处理</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>申请人</th><th>真实姓名</th><th>性别</th><th>学号</th><th>手机号</th><th>规则版本</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${(data.applications||[]).map(item=>`<tr><td><span class="cell-main">${escapeHtml(item.name)}</span></td><td>${escapeHtml(item.realName||'—')}</td><td>${item.gender==='male'?'男':item.gender==='female'?'女':'—'}</td><td>${escapeHtml(item.studentId)}</td><td>${escapeHtml(item.phone)}</td><td>${escapeHtml(item.rulesVersion||'-')}</td><td>${statusPill(item.status,item.statusText)}</td><td><div class="table-actions"><button class="secondary-button" data-action="review-rider" data-id="${escapeHtml(item.id)}" data-approved="false">驳回</button><button class="secondary-button" data-action="review-rider" data-id="${escapeHtml(item.id)}" data-approved="true">通过</button></div></td></tr>`).join('')||emptyRow(8,'暂无骑手申请')}
    </tbody></table></div></article>
    <article class="panel spaced-panel"><div class="panel-header"><h4>骑手名单</h4><span>${keyword?`匹配 ${riders.length} / ${allRiders.length} 人 · `:''}恢复资格会清零当前有效超时，历史记录保留</span></div><div class="panel-body">
      <form id="riderFilter" class="toolbar"><label>搜索骑手<input name="keyword" value="${escapeHtml(keyword)}" placeholder="姓名 / 学号 / 手机号"></label><button class="primary-button" type="submit">查询</button><button class="ghost-button" type="button" data-action="reset-riders">重置</button></form>
    </div><div class="table-wrap"><table class="data-table"><thead><tr><th>骑手</th><th>姓名备注</th><th>性别</th><th>手机号</th><th>等级 / 经验</th><th>当前任务</th><th>余额</th><th>观察期金额</th><th>资格</th><th>操作</th></tr></thead><tbody>
    ${riders.map(item=>`<tr><td><span class="cell-main">${escapeHtml(item.name)}</span><span class="cell-sub">${escapeHtml(item.studentId)}</span></td><td><input class="name-note-input" data-name-note data-id="${escapeHtml(item.id)}" data-original="${escapeHtml(item.nameNote||'')}" value="${escapeHtml(item.nameNote||'')}" placeholder="点击填写" maxlength="40"></td><td><select class="gender-select" data-gender data-id="${escapeHtml(item.id)}"><option value=""${item.gender?'':' selected'}>未填</option><option value="male"${item.gender==='male'?' selected':''}>男</option><option value="female"${item.gender==='female'?' selected':''}>女</option></select></td><td><input class="phone-input" data-phone data-id="${escapeHtml(item.id)}" data-original="${escapeHtml(item.phone||'')}" value="${escapeHtml(item.phone||'')}" maxlength="11" placeholder="11位手机号"></td><td>Lv${Number(item.riderLevel)||1} ${escapeHtml(item.riderLevelName||'新手骑手')}<span class="cell-sub">${Number(item.experiencePoints)||0} 经验</span></td><td>${Number(item.activeOrders)||0}/${Number(item.maxActiveOrders)||3}</td><td>¥${money(item.availableBalance)}</td><td>¥${money(item.frozenBalance)}</td><td>${statusPill(item.status)}</td><td><div class="table-actions"><button class="secondary-button" data-action="rider-status" data-id="${escapeHtml(item.id)}" data-status-action="${item.status==='suspended'?'restore':'suspend'}">${item.status==='suspended'?'恢复资格':'暂停接单'}</button></div></td></tr>`).join('')||emptyRow(10,keyword?'没有匹配的骑手':'暂无骑手')}
    </tbody></table></div></article>`
  document.querySelector('#riderFilter')?.addEventListener('submit', event => {
    event.preventDefault();const form=new FormData(event.currentTarget);renderViewWith(()=>renderRiders({keyword:String(form.get('keyword')||'').trim()}))
  })
}

async function renderAfterSales() {
  const data = await adminApi.afterSales(currentCampus())
  const typeText = { missing_delivery: '未收到快递', rider_exception: '骑手异常' }
  elements.pageContent.innerHTML = `${pageHeading('售后理赔','核对订单、物品价值证明和送达照片；单笔赔付不得超过200元。','<button class="secondary-button" data-action="refresh">刷新</button>')}
  <article class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>售后编号</th><th>订单</th><th>用户 / 骑手</th><th>用户手机号</th><th>骑手手机号</th><th>上报骑手</th><th>问题</th><th>上报理由</th><th>申请金额</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
  ${(data.items||[]).map(item=>`<tr><td><span class="cell-main">${escapeHtml(item.id)}</span></td><td>${escapeHtml(item.orderId)}</td><td>${escapeHtml(item.userName)}<span class="cell-sub">骑手：${escapeHtml(item.riderName)}</span></td><td>${item.userPhone?escapeHtml(item.userPhone):'-'}</td><td>${item.riderPhone?escapeHtml(item.riderPhone):'-'}</td><td>${item.reporterRiderName?escapeHtml(item.reporterRiderName):'-'}</td><td>${escapeHtml(typeText[item.type] || item.type)}<span class="cell-sub">物品价值 ¥${money(item.itemValue)}</span></td><td>${item.description?escapeHtml(item.description):'-'}</td><td class="price-cell">¥${money(item.claimAmount)}</td><td>${dateTime(item.createdAtMs)}</td><td>${statusPill(item.status)}</td><td>${item.status!=='resolved'?`<div class="table-actions"><button class="secondary-button" data-action="resolve-after-sale" data-id="${escapeHtml(item.id)}" data-amount="${Number(item.claimAmount)||0}">处理</button>${item.orderStatus==='disputed'?`<button class="primary-button" data-action="convert-after-sale" data-id="${escapeHtml(item.id)}">转为正常完成</button>`:''}${!['completed','cancelled'].includes(item.orderStatus)?`<button class="danger-button" data-action="cancel-after-sale-order" data-order-id="${escapeHtml(item.orderId)}" data-paid="${Number(item.paidAmount)||0}">取消订单退款退券</button>`:''}</div>`:`赔付 ¥${money(item.compensationAmount)}`}</td></tr>`).join('')||emptyRow(12)}
  </tbody></table></div></article>`
}

async function renderFeedbacks() {
  const data = await adminApi.feedbacks(currentCampus())
  const items = data.items || []
  const unread = items.filter(item => item.status === 'unread').length
  const categoryLabel = { suggestion: '功能建议', problem: '使用问题', other: '其他' }
  const statusText = { unread: '未读', read: '已读', resolved: '已处理' }
  const statusTone = { unread: 'open', read: 'processing', resolved: 'resolved' }
  elements.pageContent.innerHTML = `${pageHeading('意见反馈','查看用户提交的意见与建议，处理后归档。','<button class="secondary-button" data-action="refresh">刷新</button>')}
  <section class="stats-grid">${statCard('未读意见',unread,'待管理员查看','warning')}${statCard('累计意见',data.total||0,'全部反馈')}</section>
  <article class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>类型</th><th>用户</th><th>意见内容</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
  ${items.map(item=>`<tr><td>${escapeHtml(categoryLabel[item.category]||item.category)}</td><td>${escapeHtml(item.userName||'匿名')}<span class="cell-sub">${escapeHtml(item.phone)} · ${escapeHtml(item.building+item.room)}</span></td><td class="feedback-content">${escapeHtml(item.content)}</td><td>${dateTime(item.createdAtMs)}</td><td>${statusPill(statusTone[item.status]||'processing',statusText[item.status]||item.status)}</td><td>${item.status!=='resolved'?`<button class="secondary-button" data-action="feedback-status" data-id="${escapeHtml(item.id)}" data-status="${item.status==='unread'?'read':'resolved'}">${item.status==='unread'?'标记已读':'标记已处理'}</button>`:'-'}</td></tr>`).join('')||emptyRow(6)}
  </tbody></table></div></article>`
}

async function renderCoupons() {
  const campus = currentCampus()
  const data = await adminApi.couponOverview(campus);const stats=data.stats||{}
  elements.pageContent.innerHTML = `${pageHeading('优惠券运营','支持定向/批量发券和一次性兑换码，正式环境由服务端保证库存与幂等。')}
  <section class="stats-grid">${statCard('累计发放',stats.total||0,'全部活动券')}${statCard('当前可用',stats.available||0,'未使用且未过期','success')}${statCard('已经使用',stats.used||0,'已完成核销')}${statCard('已经过期',stats.expired||0,'不可继续使用','warning')}</section>
  <section class="content-grid"><article class="panel"><div class="panel-header"><h4>活动券发放</h4><span>平台优惠不减少骑手收入</span></div><div class="panel-body"><form id="grantCouponForm" class="form-grid"><label>活动名称<input name="name" required maxlength="30" value="校园活动2元券"></label><label>发放范围<select name="scope"><option value="single">指定手机号</option><option value="all">全部用户</option></select></label><label>用户手机号<input name="phone" inputmode="numeric" maxlength="11" placeholder="全量发放时可留空"></label><label>发放数量<input name="quantity" type="number" min="1" max="100000" value="1" required></label><label>券面金额<input name="amount" type="number" min="0.01" max="200" step="0.01" value="2" required></label><label>使用门槛<input name="minSpend" type="number" min="0" max="999" step="0.01" value="0"></label><label>有效天数<input name="validDays" type="number" min="1" max="365" value="30" required></label><div></div><button class="primary-button" type="submit">确认发放</button></form></div></article>
  <article class="panel"><div class="panel-header"><h4>生成兑换码</h4><span>单码单次使用</span></div><div class="panel-body"><form id="couponCodeForm" class="form-grid"><label class="full-field">优惠券名称<input name="name" required value="活动抵用券"></label><label>券面金额<input name="amount" type="number" min=".01" max="200" step=".01" value="2" required></label><label>使用门槛<input name="minSpend" type="number" min="0" value="0"></label><label>有效天数<input name="validDays" type="number" min="1" max="365" value="7"></label><div></div><button class="secondary-button" type="submit">生成并复制</button></form><div class="settings-note">兑换码只应由服务端生成并保存摘要；管理台不会保存生产密钥。</div></div></article></section>
  <article class="panel spaced-panel"><div class="panel-header"><h4>券活动</h4><span>${campusLabel(campus)} · ${(data.campaigns||[]).length} 个活动</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>活动名称</th><th>面额</th><th>门槛</th><th>校区</th><th>发放</th><th>已用</th><th>状态</th><th>操作</th></tr></thead><tbody>${(data.campaigns||[]).map(item=>`<tr><td><span class="cell-main">${escapeHtml(item.name)}</span></td><td>¥${money(item.amount)}</td><td>${Number(item.minSpend)>0?`满 ¥${money(item.minSpend)}`:'无门槛'}</td><td>${item.campus?escapeHtml(campusLabel(item.campus)):'全校区'}</td><td>${item.issued}</td><td>${item.used}</td><td>${statusPill(item.status==='running'?'approved':'suspended',item.status==='running'?'进行中':'已结束')}</td></tr>`).join('')||emptyRow(8)}</tbody></table></div></article>`
  document.querySelector('#grantCouponForm')?.addEventListener('submit',submitGrantCoupon)
  document.querySelector('#couponCodeForm')?.addEventListener('submit',submitCouponCode)
}

async function renderFinance() {
  const data=await adminApi.withdrawals(currentCampus())
  elements.pageContent.innerHTML=`${pageHeading('提现审核','核对骑手可提现余额和本月提现次数，打款结果由服务端记录。','<button class="secondary-button" data-action="refresh">刷新</button>')}<article class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>提现编号</th><th>骑手</th><th>姓名</th><th>手机号</th><th>金额</th><th>申请时间</th><th>状态</th><th>操作</th></tr></thead><tbody>${(data.items||[]).map(item=>`<tr><td><span class="cell-main">${escapeHtml(item.id)}</span></td><td>${escapeHtml(item.riderName)}</td><td>${escapeHtml(item.nameNote||'—')}</td><td>${escapeHtml(item.phone)}</td><td class="price-cell">¥${money(item.amount)}</td><td>${dateTime(item.requestedAtMs)}</td><td>${statusPill(item.status)}</td><td>${item.status==='pending'?`<div class="table-actions"><button class="secondary-button" data-action="review-withdrawal" data-id="${escapeHtml(item.id)}" data-approved="false">驳回</button><button class="secondary-button" data-action="review-withdrawal" data-id="${escapeHtml(item.id)}" data-approved="true">通过</button></div>`:'-'}</td></tr>`).join('')||emptyRow(8)}</tbody></table></div></article>`
}

async function renderSettings() {
  const campus=currentCampus()
  const item=await adminApi.settings(campus)
  const canEdit=hasAnyRole('admin')
  const yuan=v=>`¥${money(v)}`
  const isShipai=campus==='shipai'
  const priceMatrix=isShipai
    ? `<table class="data-table price-matrix"><thead><tr><th>尺寸</th><th>价格</th></tr></thead><tbody>
    <tr><td>小件</td><td class="price-cell">${yuan(item.itemSmallCampusPrice)}</td></tr>
    <tr><td>中件</td><td class="price-cell">${yuan(item.itemMediumCampusPrice)}</td></tr>
    <tr><td>大件</td><td class="price-cell">${yuan(item.itemLargeCampusPrice)}</td></tr>
  </tbody></table>`
    : `<table class="data-table price-matrix"><thead><tr><th>尺寸</th><th>校内</th><th>校外</th></tr></thead><tbody>
    <tr><td>小件</td><td class="price-cell">${yuan(item.itemSmallCampusPrice)}</td><td class="price-cell">${yuan(item.itemSmallOffCampusPrice)}</td></tr>
    <tr><td>中件</td><td class="price-cell">${yuan(item.itemMediumCampusPrice)}</td><td class="price-cell">${yuan(item.itemMediumOffCampusPrice)}</td></tr>
    <tr><td>大件</td><td class="price-cell">${yuan(item.itemLargeCampusPrice)}</td><td class="price-cell">${yuan(item.itemLargeOffCampusPrice)}</td></tr>
  </tbody></table>`
  const priceExtras=[
    ['很急整单附加费',yuan(item.itemUrgentFee)],
    ['送到门口整单附加费',yuan(item.itemDoorFee)],
    ...(isShipai ? [] : [
      ...(Number(item.itemBuilding9Fee) > 0 ? [['9 栋固定附加',yuan(item.itemBuilding9Fee)]] : []),
      ['上楼门口费',yuan(item.itemUpperFloorDoorFee)]
    ]),
    ['满减第一档',`满 ${money(item.bundleTier0Threshold)} 减 ${money(item.bundleTier0Discount)}`],
    ['满减第二档',`满 ${money(item.bundleTier1Threshold)} 减 ${money(item.bundleTier1Discount)}`],
    ['满减第三档',`满 ${money(item.bundleTier2Threshold)} 减 ${money(item.bundleTier2Discount)}`],
    ['平台抽成',`${money(item.commissionRate)}%`]
  ]
  const priceExtrasHtml=priceExtras.map(([label,value])=>`<div class="price-extra"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')
  const legacyPrices=[
    ['校内基础价',yuan(item.campusPrice)],['校外基础价',yuan(item.offCampusPrice)],
    ['校内加急价',yuan(item.campusUrgentPrice)],['校外加急价',yuan(item.offCampusUrgentPrice)],
    ['每增加一件加价',yuan(item.extraPiecePrice)],['包含大件加价',yuan(item.largePrice)]
  ]
  const legacyHtml=legacyPrices.map(([label,value])=>`<div class="price-extra"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')
  const operational=canEdit
    ? `<form id="settingsOperationalForm" class="form-grid"><label>自动完成小时<input name="autoConfirmHours" type="number" min="1" max="72" value="${Number(item.autoConfirmHours)}"></label><label>售后观察小时<input name="observationHours" type="number" min="1" max="168" value="${Number(item.observationHours)}"></label><label>单笔理赔上限（元）<input name="claimLimit" type="number" min="0" max="200" value="${Number(item.claimLimit)}"></label><div></div><button class="primary-button" type="submit">保存运营参数</button></form>`
    : `<div class="price-grid"><div class="price-extra"><span>自动完成小时</span><strong>${Number(item.autoConfirmHours)}</strong></div><div class="price-extra"><span>售后观察小时</span><strong>${Number(item.observationHours)}</strong></div><div class="price-extra"><span>单笔理赔上限</span><strong>¥${money(item.claimLimit)}</strong></div></div>`
  const service=canEdit
    ? `<form id="settingsServiceStatusForm" class="form-grid"><label class="full-field">服务状态<select name="serviceStatus"><option value="open" ${item.serviceStatus!=='closed'?'selected':''}>正常营业</option><option value="closed" ${item.serviceStatus==='closed'?'selected':''}>停止服务</option></select></label><label class="full-field">停服提示文案<input name="serviceNotice" maxlength="200" value="${escapeHtml(item.serviceNotice||'')}"></label><div class="full-field settings-note">切换为「停止服务」后，小程序端显示停服提示，并停止接收新订单与新抢单；进行中的订单照常走完。</div><button class="primary-button" type="submit">保存服务状态</button></form>`
    : `<div class="price-grid"><div class="price-extra"><span>服务状态</span><strong>${item.serviceStatus==='closed'?'停止服务':'正常营业'}</strong></div><div class="price-extra"><span>停服提示文案</span><strong>${escapeHtml(item.serviceNotice||'—')}</strong></div></div>`
  elements.pageContent.innerHTML=`${pageHeading('平台设置','价格只读，运营参数与服务状态分组保存。')}
    <article class="panel"><div class="panel-header"><h4>当前生效价格</h4><span class="readonly-badge">只读 · 改价走受控发布</span></div><div class="panel-body">
      <div class="settings-note blue">价格随小程序版本发布，不能在管理台单独修改；改价必须走受控发布流程。</div>
      ${priceMatrix}
      <div class="price-grid">${priceExtrasHtml}</div>
      ${isShipai ? '' : `<details class="legacy-settings"><summary>旧版小程序兼容价格（仅旧客户端下单使用，只读）</summary><div class="price-grid">${legacyHtml}</div></details>`}
    </div></article>
    <article class="panel spaced-panel"><div class="panel-header"><h4>运营参数</h4><span>${canEdit?'自动完成、观察期、理赔上限':'只读'}</span></div><div class="panel-body">${operational}</div></article>
    <article class="panel spaced-panel"><div class="panel-header"><h4>服务状态</h4><span>${canEdit?'停服开关与提示文案':'只读'}</span></div><div class="panel-body">${service}</div></article>
    <article class="panel spaced-panel"><div class="panel-header"><h4>审核模式</h4><span>整站开关，点击立即生效</span></div><div class="panel-body">
      <div>当前状态：${item.reviewMode?'<span class="status-pill orange">审核中</span>':'<span class="status-pill green">正常模式</span>'}</div>
      <div class="settings-note">开启后整站进入审核演示状态：下单入口跳演示页、未支付订单没有「去支付」、骑手收入/钱包/优惠券/价格明细全部隐藏、<strong>紧急单邮件告警停止发送</strong>、新登录会注入审核账号。<strong>微信提审前开启，审核通过后必须立刻关闭</strong>——若在已发布状态下开着，用户付不了钱、骑手钱包加载不出来。</div>
      ${canEdit?`<button id="reviewModeToggle" type="button" data-review-mode="${item.reviewMode?'1':'0'}" class="${item.reviewMode?'primary-button':'secondary-button'}">${item.reviewMode?'退出审核模式':'进入审核模式'}</button>`:''}
    </div></article>`
  document.querySelector('#settingsOperationalForm')?.addEventListener('submit',submitOperational)
  document.querySelector('#settingsServiceStatusForm')?.addEventListener('submit',submitServiceStatus)
  document.querySelector('#reviewModeToggle')?.addEventListener('click',toggleReviewMode)
}

const renderers={overview:renderOverview,income:renderIncome,orders:renderOrders,riders:renderRiders,afterSales:renderAfterSales,feedbacks:renderFeedbacks,coupons:renderCoupons,finance:renderFinance,settings:renderSettings}

async function renderViewWith(renderer) {
  renderLoading()
  try { await renderer() } catch (error) { elements.pageContent.innerHTML='<div class="empty-box">数据加载失败，请稍后重试。</div>';errorMessage(error) }
}

function switchView(view) {
  if (!renderers[view] || !canAccessView(view)) return
  currentView=view
  const meta=viewMeta[view]
  elements.viewEyebrow.textContent=meta[0];elements.viewTitle.textContent=meta[1]
  elements.navList.querySelectorAll('button[data-view]').forEach(button=>{
    const active=button.dataset.view===view
    button.classList.toggle('active',active)
    if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current')
  })
  elements.adminApp.classList.remove('menu-open')
  renderViewWith(renderers[view])
}

async function submitGrantCoupon(event) {
  event.preventDefault();const form=new FormData(event.currentTarget)
  try { await adminApi.grantCoupon(Object.fromEntries(form.entries()), currentCampus());toast('优惠券发放任务已创建');switchView('coupons') } catch(error){errorMessage(error)}
}

async function submitCouponCode(event) {
  event.preventDefault();const form=new FormData(event.currentTarget)
  try { const result=await adminApi.createCouponCode(Object.fromEntries(form.entries()), currentCampus());await navigator.clipboard.writeText(result.code).catch(()=>{});toast(`兑换码 ${result.code} 已生成并复制`) } catch(error){errorMessage(error)}
}

async function submitOperational(event) {
  event.preventDefault();const form=new FormData(event.currentTarget)
  const data={autoConfirmHours:Number(form.get('autoConfirmHours')),observationHours:Number(form.get('observationHours')),claimLimit:Number(form.get('claimLimit'))}
  if(!Number.isFinite(data.autoConfirmHours)||data.autoConfirmHours<1||data.autoConfirmHours>72){toast('自动完成小时必须在 1—72 之间','error');return}
  if(!Number.isFinite(data.observationHours)||data.observationHours<1||data.observationHours>168){toast('售后观察小时必须在 1—168 之间','error');return}
  if(!Number.isFinite(data.claimLimit)||data.claimLimit<0||data.claimLimit>200){toast('单笔理赔上限必须在 0—200 元之间','error');return}
  try{await adminApi.updateOperational(data);toast('运营参数已保存');switchView('settings')}catch(error){errorMessage(error)}
}

async function submitServiceStatus(event) {
  event.preventDefault();const form=new FormData(event.currentTarget)
  const data={serviceStatus:String(form.get('serviceStatus')||'open'),serviceNotice:String(form.get('serviceNotice')||'').slice(0,200)}
  if(!['open','closed'].includes(data.serviceStatus)){toast('服务状态取值无效','error');return}
  if(data.serviceStatus==='closed'&&!window.confirm('确认停止服务？停止后所有用户将看到停服提示，且不再接收新订单和新抢单，进行中的订单不受影响。'))return
  try{await adminApi.updateServiceStatus(data);toast(data.serviceStatus==='closed'?'已停止服务，小程序端将显示停服提示':'平台服务状态已保存');switchView('settings')}catch(error){errorMessage(error)}
}

async function toggleReviewMode(event) {
  const enabled=event.currentTarget.dataset.reviewMode!=='1'
  const message=enabled
    ?'确认进入审核模式？整站进入审核演示状态：用户付不了钱、骑手钱包与收入隐藏、紧急单邮件告警停止发送。微信审核通过后必须立刻退出。'
    :'确认退出审核模式？整站恢复正常：用户可正常下单支付，骑手钱包与收入恢复显示，紧急单邮件告警恢复发送。'
  if(!window.confirm(message))return
  try { await adminApi.setReviewMode(enabled);toast(enabled?'已进入审核模式，微信审核通过后请立刻退出':'已退出审核模式，整站恢复正常');switchView('settings') } catch(error){errorMessage(error)}
}

const THEME_KEY='campus_admin_theme'
const THEME_ORDER=['system','light','dark']
const THEME_LABELS={system:'跟随系统',light:'浅色',dark:'深色'}

function themePreference(){try{const v=localStorage.getItem(THEME_KEY);return THEME_ORDER.includes(v)?v:'system'}catch(_){return 'system'}}
function applyTheme(pref){
  const resolved=pref==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):pref
  document.documentElement.setAttribute('data-theme',resolved)
  if(elements.themeToggle){elements.themeToggle.textContent=THEME_LABELS[pref];elements.themeToggle.dataset.theme=pref}
}
function cycleTheme(){
  const pref=themePreference();const next=THEME_ORDER[(THEME_ORDER.indexOf(pref)+1)%THEME_ORDER.length]
  try{localStorage.setItem(THEME_KEY,next)}catch(_){}
  applyTheme(next)
}
function initTheme(){
  applyTheme(themePreference())
  if(window.matchMedia)window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(themePreference()==='system')applyTheme('system')})
}

elements.loginForm.addEventListener('submit',async event=>{
  event.preventDefault();const button=event.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent='正在登录…'
  try { const result=await adminApi.login(Object.fromEntries(new FormData(event.currentTarget).entries()));saveSession(result);session=readSession();showAdmin() } catch(error){errorMessage(error)} finally{button.disabled=false;button.textContent='安全登录'}
})
elements.navList.addEventListener('click',event=>{const button=event.target.closest('button[data-view]');if(button)switchView(button.dataset.view)})
elements.campusSwitcher.addEventListener('click',event=>{
  const button=event.target.closest('button[data-campus]');if(!button)return
  selectCampus(button.dataset.campus);renderCampusChrome();switchView(currentView)
})
elements.logoutButton.addEventListener('click',()=>{clearSession();showLogin()})
elements.menuButton.addEventListener('click',()=>{if(window.matchMedia('(max-width: 760px)').matches){elements.adminApp.classList.add('menu-open')}else{elements.adminApp.classList.toggle('sidebar-collapsed')}})
elements.mobileMask.addEventListener('click',()=>elements.adminApp.classList.remove('menu-open'))
elements.pageContent.addEventListener('click',async event=>{
  const target=event.target.closest('[data-action]');if(!target)return
  const action=target.dataset.action
  if(action==='refresh'){switchView(currentView);return}
  if(action==='reset-orders'){renderViewWith(()=>renderOrders({}));return}
  if(action==='reset-riders'){renderViewWith(()=>renderRiders({}));return}
  try {
    if(action==='view-order-attachments'){
      await openOrderAttachments(target.dataset.id);return
    }
    if(action==='review-rider'){
      const approved=target.dataset.approved==='true';const reason=approved?'审核资料符合要求':window.prompt('请输入驳回原因','资料信息需要补充')
      if(reason===null)return;if(!window.confirm(approved?'确认通过该骑手申请？':'确认驳回该骑手申请？'))return
      await adminApi.reviewApplication(target.dataset.id,approved,reason);toast(approved?'骑手申请已通过':'骑手申请已驳回');switchView('riders')
    }
    if(action==='rider-status'){
      const statusAction=target.dataset.statusAction;const reason=window.prompt(statusAction==='restore'?'请输入恢复说明':'请输入暂停原因',statusAction==='restore'?'管理员复核后恢复':'运营风控处理')
      if(reason===null)return;await adminApi.setRiderStatus(target.dataset.id,statusAction,reason);toast(statusAction==='restore'?'骑手资格已恢复，当前有效超时已清零':'骑手接单资格已暂停');switchView('riders')
    }
    if(action==='resolve-after-sale'){
      const amountText=window.prompt('请输入最终赔付金额（最高200元）',String(target.dataset.amount||0));if(amountText===null)return
      const amount=Number(amountText);if(!Number.isFinite(amount)||amount<0||amount>200){toast('赔付金额必须在0—200元之间','error');return}
      const resolution=window.prompt('请输入处理结论','已核实材料并完成处理');if(resolution===null||!resolution.trim())return
      await adminApi.resolveAfterSale(target.dataset.id,resolution.trim(),amount);toast('售后处理已完成');switchView('afterSales')
    }
    if(action==='convert-after-sale'){
      if(!window.confirm('确认将该售后订单转为正常已完成？骑手收入将立即结算到可提现余额。'))return
      await adminApi.convertAfterSaleToCompleted(target.dataset.id);toast('订单已转为正常完成，骑手收入已结算');switchView('afterSales')
    }
    if(action==='cancel-after-sale-order'){
      const paid=Number(target.dataset.paid)||0
      const refundHint=paid>0?`将原路退回实付 ¥${money(paid)}，并退回该单使用的优惠券。`:'该单实付 0 元，将退回该单使用的优惠券。'
      if(!window.confirm(`确认取消该订单并退款退券？${refundHint}金额不会划入骑手账户，骑手端将同步移除该单。`))return
      await adminApi.cancelOrder(target.dataset.orderId);toast('订单已取消，退款退券处理中');switchView('afterSales')
    }
    if(action==='review-withdrawal'){
      const approved=target.dataset.approved==='true';const reason=approved?'财务复核通过':window.prompt('请输入驳回原因','余额或账户信息需要核对')
      if(reason===null)return;if(!window.confirm(approved?'确认通过并标记为已打款？':'确认驳回提现申请？'))return
      await adminApi.reviewWithdrawal(target.dataset.id,approved,reason);toast(approved?'提现申请已通过':'提现申请已驳回');switchView('finance')
    }
    if(action==='feedback-status'){
      const status=target.dataset.status
      await adminApi.setFeedbackStatus(target.dataset.id,status);toast(status==='resolved'?'意见已标记为已处理':'意见已标记为已读');switchView('feedbacks')
    }
    if(action==='cancel-order'){
      const paid=Number(target.dataset.paid)||0
      const refundHint=paid>0?`将原路退回实付 ¥${money(paid)}，并退回该单使用的优惠券。`:'该单实付 0 元，将退回该单使用的优惠券。'
      if(!window.confirm(`确认取消该订单？${refundHint}骑手端将同步移除该单。`))return
      await adminApi.cancelOrder(target.dataset.id);toast('订单已取消');switchView('orders')
    }
    if(action==='withhold-rider-income'){
      const rider=target.dataset.rider||''
      if(!window.confirm(`确认该单骑手收入不划给骑手${rider?`「${rider}」`:''}？标记后骑手将无法获得该单收入，且不可撤销。`))return
      await adminApi.withholdRiderIncome(target.dataset.id);toast('已标记：该单不划给骑手');switchView('orders')
    }
    if(action==='open-ledger-form'){
      ledgerForm={...emptyLedgerForm(),open:true,category:'other_expense'};renderViewWith(renderIncome);return
    }
    if(action==='close-ledger-form'){
      ledgerForm=emptyLedgerForm();renderViewWith(renderIncome);return
    }
    if(action==='edit-ledger-entry'){
      ledgerForm={
        open:true,id:String(target.dataset.id||''),entryDate:String(target.dataset.date||''),
        category:String(target.dataset.category||''),customCategory:String(target.dataset.custom||''),
        direction:String(target.dataset.direction||'expense'),amount:String(target.dataset.amount||''),
        note:String(target.dataset.note||'')
      }
      renderViewWith(renderIncome);return
    }
    if(action==='delete-ledger-entry'){
      if(!window.confirm(`确认删除这笔账目？\n${target.dataset.summary||''}\n删除后「实际净收入」会立刻少掉这笔金额，且不可恢复。`))return
      await adminApi.deleteLedgerEntry(target.dataset.id, currentCampus())
      ledgerForm=emptyLedgerForm();ledgerPage=1;toast('账目已删除');switchView('income');return
    }
    if(action==='ledger-prev'){ledgerPage=Math.max(1,ledgerPage-1);renderViewWith(renderIncome);return}
    if(action==='ledger-next'){ledgerPage+=1;renderViewWith(renderIncome);return}
  }catch(error){errorMessage(error)}
})

// 骑手「姓名备注」内联编辑：失焦保存（用 focusout 委托，因为 blur 不冒泡）。
// 骑手「手机号」内联编辑：同一委托，须为 1 开头的 11 位有效手机号，不合法恢复原值并提示。
elements.pageContent.addEventListener('focusout', async event => {
  const noteInput = event.target.closest('input[data-name-note]')
  const phoneInput = event.target.closest('input[data-phone]')
  if (noteInput) {
    const value = String(noteInput.value || '').trim().slice(0, 40)
    const original = String(noteInput.dataset.original || '')
    if (value === original) return
    noteInput.disabled = true
    try {
      await adminApi.setRiderNameNote(noteInput.dataset.id, value)
      noteInput.dataset.original = value
      toast('姓名备注已保存')
    } catch (error) {
      noteInput.value = original
      errorMessage(error)
    } finally {
      noteInput.disabled = false
    }
    return
  }
  if (!phoneInput) return
  const value = String(phoneInput.value || '').trim()
  const original = String(phoneInput.dataset.original || '')
  if (value === original) return
  if (!/^1[3-9]\d{9}$/.test(value)) {
    phoneInput.value = original
    toast('手机号须为1开头的11位数字')
    return
  }
  phoneInput.disabled = true
  try {
    await adminApi.setRiderPhone(phoneInput.dataset.id, value)
    phoneInput.dataset.original = value
    toast('骑手手机号已保存')
  } catch (error) {
    phoneInput.value = original
    errorMessage(error)
  } finally {
    phoneInput.disabled = false
  }
})

// 骑手性别下拉：选择后立即保存。
elements.pageContent.addEventListener('change', async event => {
  const select = event.target.closest('select[data-gender]')
  if (!select) return
  const gender = String(select.value || '')
  try {
    await adminApi.setRiderGender(select.dataset.id, gender)
    toast(gender === 'male' ? '性别已设为男' : gender === 'female' ? '性别已设为女' : '性别已清空')
  } catch (error) {
    errorMessage(error)
    switchView('riders')
  }
})

elements.attachmentCloseButton.addEventListener('click',closeAttachmentModal)
elements.attachmentModal.addEventListener('click',async event=>{
  if(event.target===elements.attachmentModal){closeAttachmentModal();return}
  const target=event.target.closest('[data-action]');if(!target)return
  try {
    if(target.dataset.action==='download-attachment')await readOrderAttachment(target)
  }catch(error){errorMessage(error)}
})
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!elements.attachmentModal.hidden)closeAttachmentModal()})

function updateNetwork(){elements.offlineNotice.hidden=navigator.onLine}
window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork)
window.addEventListener('admin:unauthorized',showLogin)
updateNetwork()
if(elements.themeToggle)elements.themeToggle.addEventListener('click',cycleTheme)
initTheme()
if(config.enableMock){elements.mockCredential.hidden=false;elements.mockCredential.textContent='本地预览账号：admin　密码：admin123（仅 Mock 环境有效）'}
initCampusSwitcher()
if(session)showAdmin();else showLogin()
