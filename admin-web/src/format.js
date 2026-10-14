export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

export function money(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

export function dateTime(value) {
  const date = new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date).replaceAll('/', '-')
}

export function sizeSummary(item) {
  const SIZE_LABEL = { small: '小件', medium: '中件', large: '大件' }
  const SIZE_ORDER = ['small', 'medium', 'large']
  const details = Array.isArray(item && item.itemDetails) ? item.itemDetails : []
  const fallback = `${Number(item && item.pieces) || 0}件${item && item.isLarge ? ' · 大件' : ''}`
  if (!details.length) return fallback
  const counts = { small: 0, medium: 0, large: 0 }
  let valid = 0
  details.forEach(entry => { if (entry && SIZE_LABEL[entry.size]) { counts[entry.size]++; valid++ } })
  if (!valid) return fallback
  const parts = []
  SIZE_ORDER.forEach(size => { if (counts[size]) parts.push(`${SIZE_LABEL[size]}×${counts[size]}`) })
  return parts.join(' · ')
}

export function statusMeta(status) {
  return {
    waiting: ['待接单', 'orange'], accepted: ['已接单', ''], picked: ['已取件', ''], delivering: ['配送中', ''],
    delivered: ['待确认', 'green'], completed: ['已完成', 'green'], cancelled: ['已取消', 'red'], disputed: ['售后中', 'red'],
    pending: ['待审核', 'orange'], approved: ['已通过', 'green'], rejected: ['已驳回', 'red'], suspended: ['已暂停', 'red'],
    open: ['待处理', 'orange'], processing: ['处理中', ''], resolved: ['已完成', 'green'],
    paid: ['已打款', 'green']
  }[status] || [String(status || '未知'), '']
}

export function statusPill(status, customText) {
  const [label, tone] = statusMeta(status)
  return `<span class="status-pill ${tone}">${escapeHtml(customText || label)}</span>`
}

export function queryString(parameters) {
  const query = new URLSearchParams()
  Object.entries(parameters || {}).forEach(([key, value]) => {
    if (value !== '' && value != null) query.set(key, String(value))
  })
  const text = query.toString()
  return text ? `?${text}` : ''
}
