const { BUSINESS } = require('../config/constants')

function getRiderAccess(user) {
  const safeUser = user && typeof user === 'object' ? user : {}
  if (safeUser.riderApproved) return { allowed:true, reason:'' }
  if (safeUser.riderStatus === 'suspended') return { allowed:false, reason:'因累计3次有效超时，你的接单资格已暂停，请联系管理员恢复。' }
  return { allowed:false, reason:'骑手申请尚未通过审核。' }
}

function canGrabOrder(activeCount, maxActiveOrders) {
  const limit = Math.max(1, Number(maxActiveOrders) || BUSINESS.maxActiveRiderOrders)
  return Math.max(0, Number(activeCount) || 0) < limit
}

module.exports = { getRiderAccess, canGrabOrder }
