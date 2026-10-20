const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const time = require('../../../utils/time')
const { paginate } = require('../../../utils/pagination')
const { createRecycleList, replaceRecycleData, renderRecycleData } = require('../../../utils/recycle-list')
const { getListViewport, rpxToPx } = require('../../../utils/system')
const { getRiderAccess, canGrabOrder } = require('../../../utils/permissions')
const { ROUTES, buildingGender, BUILDING_GENDER_TEXT, getCampusConfig } = require('../../../config/constants')
const { emptyFilters, buildFilterView, filterOrders } = require('../../../utils/order-filters')
const orderApi = require('../../../utils/order-api')
const { getRiderProgress } = require('../../../utils/rider-level')
const modeStore = require('../../../utils/mode')

const viewport = getListViewport(394)
const itemHeight = rpxToPx(448, viewport.windowWidth)
// 置灰卡多一条原因条：12*2 padding + 32 line-height + 14 margin-bottom = 70rpx（.block-reason 的 line-height 已显式固定，勿改单边）
const blockedItemHeight = rpxToPx(518, viewport.windowWidth)
const itemGap = rpxToPx(20, viewport.windowWidth)
const initialProgress = getRiderProgress(0)
const HALL_FRESH_MS = 5 * 1000

createPage({
  data: {
    recycleOrders: [], listTotal: 0, taskCount: 0, maxActiveOrders: initialProgress.maxActiveOrders,
    riderProgress: initialProgress, loading: true, refreshing: false, hasMore: false,
    serviceClosed: false, serviceNotice: '', reviewMode: true,
    filters: {}, filterGroups: [], activeChips: [], activeCount: 0, filterOpen: false,
    listWidth: viewport.width, listHeight: viewport.height, listItemGap: itemGap
  },
  onReady() {
    this.recycleContext = createRecycleList({
      page: this,
      id: 'hallOrderRecycle',
      dataKey: 'recycleOrders',
      width: viewport.width,
      // 行高随置灰状态变化（普通 448 / 置灰 518rpx），recycle-view 官方支持函数式 itemSize 逐项声明
      itemSize: item => ({ width: viewport.width, height: item.heightPx || itemHeight })
    })
    replaceRecycleData(this.recycleContext, this.pendingOrders)
  },
  onShow() {
    const user = store.getUser() || {}
    const settings = store.getSettings()
    const riderProgress = getRiderProgress(user.riderProgress || user)
    this.riderProgress = riderProgress
    // 按骑手校区动态初始化筛选器（石牌=驿站，其余=校内/校外）
    const campus = user.campus || 'nanhai'
    const campusCfg = getCampusConfig(campus)
    const stations = (campusCfg && campusCfg.stations) || []
    this.campus = campus
    this.stations = stations
    if (this.filterCampus !== campus) {
      this.filterCampus = campus
      const filters = emptyFilters(campus, stations)
      this.setData(Object.assign({ filters }, buildFilterView(filters, campus, stations, settings.reviewMode !== false)))
    }
    this.$setDataChanged({
      serviceClosed: settings.serviceStatus === 'closed',
      serviceNotice: settings.serviceNotice || '',
      reviewMode: settings.reviewMode !== false,
      riderProgress,
      maxActiveOrders: riderProgress.maxActiveOrders
    })
    const access = getRiderAccess(user)
    if (!access.allowed) {
      wx.showModal({
        title: '暂时无法接单',
        content: access.reason,
        showCancel: false,
        success: () => wx.switchTab({ url: ROUTES.profile })
      })
      return
    }
    modeStore.setMode('rider')
    this.refresh()
  },
  refresh(options = {}) {
    if (this.refreshTask) return this.refreshTask
    const manual = options.manual === true
    if (manual) this.setData({ refreshing: true })
    if (!Array.isArray(this.allOrders)) {
      this.allOrders = []
      this.taskCount = 0
      this.applyFilter(this.data.filters, manual)
    }
    if (!manual && this.hallRefreshedAt && Date.now() - this.hallRefreshedAt < HALL_FRESH_MS) return Promise.resolve()
    this.refreshTask = orderApi.listRiderHall().then(result => {
      // 可接性由后端统一判定下发 blocked/blockReason，前端不再本地藏单，只负责置灰展示
      this.allOrders = (result.items || []).map(item => {
        // 后端已按楼层算好性别（房间号仍隐藏）；后端未返回时按楼栋本地兜底
        const campusCfg = getCampusConfig(item.campus)
        const gender = item.buildingGender || buildingGender(item.building, '', campusCfg && campusCfg.buildingGender)
        return Object.assign({}, item, {
          buildingGender: gender,
          buildingGenderText: item.buildingGenderText || BUILDING_GENDER_TEXT[gender] || '',
          heightPx: item.blocked ? blockedItemHeight : itemHeight
        })
      })
      this.hallRefreshedAt = Date.now()
      this.taskCount = Number(result.activeCount) || 0
      this.riderProgress = getRiderProgress(result.riderProgress || Object.assign({}, this.riderProgress, { activeCount: this.taskCount }))
      this.maxActiveOrders = this.riderProgress.maxActiveOrders
      const user = store.getUser()
      if (user && user.riderApproved) store.setUser(Object.assign({}, user, {
        experiencePoints: this.riderProgress.experiencePoints,
        riderLevel: this.riderProgress.level,
        riderLevelName: this.riderProgress.levelName,
        maxActiveOrders: this.riderProgress.maxActiveOrders,
        riderProgress: this.riderProgress
      }))
      this.applyFilter(this.data.filters, manual)
      if (manual) wx.showToast({ title: '已刷新', icon: 'none' })
      return true
    }).catch(error => {
      wx.showToast({ title:String(error && error.message || '订单大厅加载失败').slice(0,20), icon:'none' })
      return false
    }).finally(() => {
      this.refreshTask = null
      if (manual) this.setData({ refreshing: false })
    })
    return this.refreshTask
  },
  manualRefresh() {
    if (this.refreshTask || this.data.refreshing) return
    this.refresh({ manual: true })
  },
  applyFilter(filters, resetPage) {
    const active = filters || this.data.filters
    this.filteredOrders = filterOrders(this.allOrders, active)
    this.currentPage = resetPage ? 1 : (this.currentPage || 1)
    const result = paginate(this.filteredOrders, this.currentPage, 20)
    this.pendingOrders = result.items
    renderRecycleData(this, this.recycleContext, result.items, Object.assign({
      listTotal: result.items.length, taskCount: this.taskCount || 0,
      maxActiveOrders: this.maxActiveOrders || initialProgress.maxActiveOrders,
      riderProgress: this.riderProgress || initialProgress,
      hasMore: result.hasMore, loading: false
    }, buildFilterView(active, this.campus, this.stations, this.data.reviewMode)))
  },
  onReviewModeChanged() {
    const filters = Object.assign({}, this.data.filters)
    if (this.data.reviewMode && filters.urgency === 'soon') filters.urgency = ''
    this.setData({ filters })
    if (Array.isArray(this.allOrders)) this.applyFilter(filters, false)
    else this.setData(buildFilterView(filters, this.campus, this.stations, this.data.reviewMode))
  },
  toggleFilterPanel() { this.setData({ filterOpen: !this.data.filterOpen }) },
  closeFilterPanel() { if (this.data.filterOpen) this.setData({ filterOpen: false }) },
  // 面板即时生效（收起态 chip 同步反馈）；点已选中的项＝取消该维度
  pickFilterOption(event) {
    const { group, value } = event.currentTarget.dataset
    if (!group || !value) return
    if (this.data.reviewMode && group === 'urgency' && value === 'soon') return
    const filters = Object.assign({}, this.data.filters)
    filters[group] = filters[group] === value ? '' : value
    this.setData({ filters })
    this.applyFilter(filters, true)
  },
  clearFilterChip(event) {
    const group = event.currentTarget.dataset.group
    if (!group) return
    const filters = Object.assign({}, this.data.filters)
    filters[group] = ''
    this.setData({ filters })
    this.applyFilter(filters, true)
  },
  resetFilters() {
    const filters = emptyFilters(this.campus, this.stations)
    this.setData({ filters })
    this.applyFilter(filters, true)
  },
  loadMore() {
    if (!this.data.hasMore) return
    this.currentPage += 1
    this.applyFilter(this.data.filters, false)
  },
  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()) },
  grab(event) {
    if (this.data.serviceClosed) { wx.showModal({ title:'暂停服务', content: this.data.serviceNotice || '节假日小程序暂停服务，暂不接单', showCancel:false }); return }
    if (!canGrabOrder(this.data.taskCount, this.data.maxActiveOrders)) {
      wx.showToast({ title: `已达到${this.data.maxActiveOrders}单上限`, icon: 'none' })
      return
    }
    const id = event.detail && event.detail.id
    const order = (this.allOrders || []).find(item => item.id === id)
    if (!order || order.status !== 'waiting') { wx.showToast({ title: '订单已被接走', icon: 'none' }); this.refresh(); return }
    if (order.blocked) { wx.showToast({ title: order.blockReason || '该订单暂不可接', icon: 'none' }); return }
    wx.showModal({
      title: '确认抢单？',
      content: `${order.pieces}件快递\n${order.isLarge ? '包含大件\n' : ''}送至${order.building}\n需在${this.data.reviewMode ? order.deadline : (order.deliveryDeadline || order.deadline)}前送达${this.data.reviewMode ? '' : `\n本单收入 ¥${order.price.toFixed(2)}`}`,
      confirmText: '确认抢单',
      success: result => {
        if (!result.confirm) return
        orderApi.acceptOrder(id).then(accepted => {
          if (accepted) store.saveOrders([accepted].concat(store.getOrders().filter(item => item.id !== accepted.id)))
          wx.showToast({ title: '抢单成功', icon: 'success' })
          this.$setTimeout(() => wx.navigateTo({ url: `${ROUTES.orderDetail}?id=${encodeURIComponent(id)}&role=rider` }), 120)
        }).catch(error => { wx.showToast({ title:String(error && error.message || '抢单失败').slice(0,20), icon:'none' }); this.refresh() })
      }
    })
  }
})
