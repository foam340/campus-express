function getAvailability(settings, now = new Date()) {
  const safeSettings = settings && typeof settings === 'object' ? settings : {}
  const safeNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date()
  const hour = safeNow.getHours()
  const openTime = /^\d{2}:\d{2}$/.test(safeSettings.openTime || '') ? safeSettings.openTime : '08:00'
  const openHour = Number(openTime.split(':')[0])
  const cutoffHour = Number(safeSettings.cutoffHour) || 20
  // 下单时间窗：每天 openTime–cutoffHour 之间可下单，「很急」「今天」共用同一个窗口
  const withinWindow = hour >= openHour && hour < cutoffHour
  return {
    urgent: withinWindow,
    today: withinWindow,
    reason: hour >= cutoffHour ? `${cutoffHour}:00后今日已停止接单` : hour < openHour ? `每日 ${openTime} 开始接单` : ''
  }
}

function getDeadline(type, settings, now = new Date()) {
  const safeType = ['urgent', 'today'].includes(type) ? type : 'today'
  const safeSettings = settings && typeof settings === 'object' ? settings : {}
  const closeTime = /^\d{2}:\d{2}$/.test(safeSettings.closeTime || '') ? safeSettings.closeTime : '20:00'
  if (safeType === 'urgent') return { text: '接单后1小时', timestamp: 0 }
  const deadline = new Date(now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date())
  deadline.setHours(Number(closeTime.split(':')[0]) || 20, Number(closeTime.split(':')[1]) || 0, 0, 0)
  return { text: `今天 ${closeTime}`, timestamp: deadline.getTime() }
}

module.exports = { getAvailability, getDeadline }
