// 骑手大厅筛选模型。
// 跨维度取交集（校内 + 女 = 校内且女生单），同维度内互斥（校内 × 校外），再点一次取消该维度。
// 每个维度用空字符串表示「不限」，所以 filters 的键必须与当前校区的 FILTER_GROUPS 的 key 一一对应。
// 「位置」维度按校区区分：石牌用「驿站」，其余（南海/广轻工）用「校内/校外」。

const BASE_GROUPS = [
  { key: 'urgency', label: '时效', options: [{ value: 'urgent', label: '很急' }, { value: 'today', label: '今天' }] },
  { key: 'type', label: '类型', options: [{ value: 'large', label: '大件' }] }
]
const TAIL_GROUPS = [
  { key: 'gender', label: '性别', options: [{ value: 'male', label: '男' }, { value: 'female', label: '女' }, { value: 'mixed', label: '混宿' }] },
  { key: 'floor', label: '楼层', options: [{ value: 'upstairs', label: '送上楼' }, { value: 'noUpstairs', label: '不送上楼' }] }
]
const SIZE_OPTIONS = [{ value: 'small', label: '小件' }, { value: 'medium', label: '中件' }, { value: 'large', label: '大件' }]

// 位置维度按校区：石牌 = 驿站列表，其余 = 校内/校外
function buildFilterGroups(campus, stations, reviewMode = false) {
  const positionGroup = campus === 'shipai'
    ? { key: 'station', label: '驿站', options: (Array.isArray(stations) ? stations : []).map(s => ({ value: s.value, label: s.label })) }
    : { key: 'scope', label: '位置', options: [{ value: 'campus', label: '校内' }, { value: 'off_campus', label: '校外' }] }
  const baseGroups = BASE_GROUPS.map(group => {
    if (reviewMode) return group
    if (group.key === 'urgency') return Object.assign({}, group, { options: [group.options[0], { value: 'soon', label: '稍急' }, group.options[1]] })
    if (group.key === 'type') return Object.assign({}, group, { options: SIZE_OPTIONS })
    return group
  })
  const tailGroups = TAIL_GROUPS
    .filter(group => !(campus === 'shipai' && !reviewMode && group.key === 'gender'))
    .map(group => campus === 'gqg' && !reviewMode && group.key === 'gender'
      ? Object.assign({}, group, { options: group.options.filter(option => option.value !== 'mixed') }) : group)
  return [...baseGroups, positionGroup, ...tailGroups]
}

function emptyFilters(campus, stations, reviewMode = false) {
  const filters = {}
  buildFilterGroups(campus, stations, reviewMode).forEach(group => { filters[group.key] = '' })
  return filters
}

// 面板高亮与收起态 chip 同源，都从 filters 推出，避免两处各判一次而不一致
function buildFilterView(filters, campus, stations, reviewMode = false) {
  const active = filters || emptyFilters(campus, stations, reviewMode)
  const filterGroups = []
  const activeChips = []
  buildFilterGroups(campus, stations, reviewMode).forEach(group => {
    let picked = null
    const options = group.options.map(option => {
      const isActive = active[group.key] === option.value
      if (isActive) picked = option
      return { value: option.value, label: option.label, active: isActive }
    })
    if (picked) activeChips.push({ key: group.key, label: picked.label })
    filterGroups.push({ key: group.key, label: group.label, options })
  })
  return { filterGroups, activeChips, activeCount: activeChips.length }
}

// 各维度按需判，未选（空值）即跳过该维度。
// 「送上楼」= 非 noUpstairs，含历史单未落该字段（undefined）的情况，与原单选逻辑一致。
function filterOrders(orders, filters, reviewMode = false) {
  const list = Array.isArray(orders) ? orders : []
  const active = filters || {}
  return list.filter(item => {
    if (active.urgency && item.urgency !== active.urgency) return false
    if (reviewMode) {
      if (active.type === 'large' && !item.isLarge) return false
    } else if (SIZE_OPTIONS.some(option => option.value === active.type)) {
      // 混合订单包含对应尺寸即可命中；老单缺明细时只保留原大件标记，不猜小/中件。
      const sizes = (Array.isArray(item.items) ? item.items : []).filter(detail => detail && SIZE_OPTIONS.some(option => option.value === detail.size)).map(detail => detail.size)
      if (sizes.length ? !sizes.includes(active.type) : !(active.type === 'large' && item.isLarge)) return false
    }
    if (active.scope) {
      const scopes = Array.isArray(item.pickupScopes) && item.pickupScopes.length ? item.pickupScopes : [item.pickupScope]
      if (!scopes.includes(active.scope)) return false
    }
    if (active.station && item.pickupStation !== active.station) return false
    if (active.gender && item.buildingGender !== active.gender) return false
    if (active.floor === 'upstairs' && item.noUpstairs) return false
    if (active.floor === 'noUpstairs' && !item.noUpstairs) return false
    return true
  })
}

module.exports = { buildFilterGroups, emptyFilters, buildFilterView, filterOrders }
