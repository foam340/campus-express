function paginate(list, page, pageSize) {
  const safeList = Array.isArray(list) ? list : []
  const safePage = Math.max(1, Math.floor(Number(page) || 1))
  const safeSize = Math.max(1, Math.min(50, Math.floor(Number(pageSize) || 20)))
  const end = safePage * safeSize
  return { items: safeList.slice(0, end), hasMore: end < safeList.length, page: safePage, pageSize: safeSize, total: safeList.length }
}

module.exports = { paginate }
