const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const { paginate } = require('../../../utils/pagination')
const { createRecycleList, replaceRecycleData, renderRecycleData } = require('../../../utils/recycle-list')
const { getListViewport, rpxToPx } = require('../../../utils/system')
const { ROUTES } = require('../../../config/constants')
const orderApi = require('../../../utils/order-api')
const { getRiderProgress } = require('../../../utils/rider-level')
const modeStore = require('../../../utils/mode')

const TASKS_FRESH_MS = 5 * 1000

const viewport = getListViewport(245)
const itemHeight = rpxToPx(230, viewport.windowWidth)
const itemGap = rpxToPx(20, viewport.windowWidth)
const initialProgress = getRiderProgress(0)

createPage({
  data: {
    recycleTasks: [], listTotal: 0, activeCount: 0, maxActiveOrders: initialProgress.maxActiveOrders,
    riderProgress: initialProgress, reviewMode: true, loading: true, hasMore: false,
    listWidth: viewport.width, listHeight: viewport.height, listItemHeight: itemHeight, listItemGap: itemGap
  },
  onReady() {
    this.recycleContext = createRecycleList({
      page: this,
      id: 'riderTaskRecycle',
      dataKey: 'recycleTasks',
      width: viewport.width,
      itemHeight
    })
    replaceRecycleData(this.recycleContext, this.pendingTasks)
  },
  onShow() {
    modeStore.setMode('rider')
    const user = store.getUser() || {}
    const riderProgress = getRiderProgress(user.riderProgress || user)
    this.riderProgress = riderProgress
    this.$setDataChanged({
      riderProgress,
      maxActiveOrders: riderProgress.maxActiveOrders,
      reviewMode: store.getSettings().reviewMode !== false
    })
    this.refresh()
  },
  refresh(options = {}) {
    if (this.refreshTask) return this.refreshTask
    const resetPage = options.resetPage === true || !this.currentPage
    if (!Array.isArray(this.allTasks)) {
      this.allTasks = []
      if (resetPage) this.currentPage = 1
      this.renderPage()
    }
    if (options.force !== true && this.tasksRefreshedAt && Date.now() - this.tasksRefreshedAt < TASKS_FRESH_MS) return Promise.resolve()
    this.refreshTask = orderApi.listRiderTasks().then(result => {
      const items = result.items || []
      this.allTasks = items
      const activeCount = items.filter(item => ['accepted','picked','delivering'].includes(item.status)).length
      this.riderProgress = getRiderProgress(result.riderProgress || Object.assign({}, this.riderProgress, { activeCount }))
      store.saveOrders(items.concat(store.getOrders().filter(item => !items.some(remote => remote.id === item.id))))
      const user = store.getUser()
      if (user && user.riderApproved) store.setUser(Object.assign({}, user, {
        experiencePoints: this.riderProgress.experiencePoints,
        riderLevel: this.riderProgress.level,
        riderLevelName: this.riderProgress.levelName,
        maxActiveOrders: this.riderProgress.maxActiveOrders,
        riderProgress: this.riderProgress
      }))
      if (resetPage) this.currentPage = 1
      this.tasksRefreshedAt = Date.now()
      this.renderPage()
    }).catch(error => wx.showToast({ title:String(error && error.message || '任务加载失败').slice(0,20), icon:'none' })).finally(() => {
      this.refreshTask = null
    })
    return this.refreshTask
  },
  renderPage() {
    const result = paginate(this.allTasks, this.currentPage, 20)
    this.pendingTasks = result.items
    renderRecycleData(this, this.recycleContext, result.items, {
      listTotal: result.items.length,
      activeCount: this.riderProgress ? this.riderProgress.activeCount : this.allTasks.filter(item => ['accepted','picked','delivering'].includes(item.status)).length,
      maxActiveOrders: this.riderProgress ? this.riderProgress.maxActiveOrders : initialProgress.maxActiveOrders,
      riderProgress: this.riderProgress || initialProgress,
      hasMore: result.hasMore, loading: false
    })
  },
  loadMore() { if (this.data.hasMore) { this.currentPage += 1; this.renderPage() } },
  onPullDownRefresh() { this.refresh({ resetPage: true, force: true }).finally(() => wx.stopPullDownRefresh()) },
  openTask(event) {
    const id = event.detail && event.detail.id
    if (id) wx.navigateTo({ url: `${ROUTES.orderDetail}?id=${encodeURIComponent(id)}&role=rider` })
  },
  goHall() { wx.switchTab({ url: ROUTES.riderHall }) }
})
