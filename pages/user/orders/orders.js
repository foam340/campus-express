const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const orderApi = require('../../../utils/order-api')
const { paginate } = require('../../../utils/pagination')
const { createRecycleList, replaceRecycleData, renderRecycleData } = require('../../../utils/recycle-list')
const { getListViewport, rpxToPx } = require('../../../utils/system')
const { ROUTES } = require('../../../config/constants')
const modeStore = require('../../../utils/mode')

const ORDERS_FRESH_MS = 5 * 1000

const viewport = getListViewport(220)
const itemHeight = rpxToPx(310, viewport.windowWidth)
const itemGap = rpxToPx(20, viewport.windowWidth)

createPage({
  data: {
    filter: 'all', recycleOrders: [], listTotal: 0, loading: true, hasMore: false,
    listWidth: viewport.width, listHeight: viewport.height, listItemHeight: itemHeight, listItemGap: itemGap,
    needLogin: false
  },
  onReady() {
    this.recycleContext = createRecycleList({
      page: this,
      id: 'userOrderRecycle',
      dataKey: 'recycleOrders',
      width: viewport.width,
      itemHeight
    })
    replaceRecycleData(this.recycleContext, this.pendingOrders)
  },
  onShow() {
    modeStore.setMode('user')
    if (!store.isRegistrationComplete()) {
      this.$setDataChanged({ needLogin: true, loading: false })
      return
    }
    this.$setDataChanged({ needLogin: false })
    this.refresh()
  },
  refresh(options = {}) {
    const resetPage = options.resetPage === true || !this.currentPage
    const orders = store.getOrders()
    this.allOrders = orders
    this.applyFilter(this.data.filter, resetPage)
    if (options.force !== true && this.ordersRefreshedAt && Date.now() - this.ordersRefreshedAt < ORDERS_FRESH_MS) return Promise.resolve()
    if (this.ordersRefreshTask) return this.ordersRefreshTask
    this.ordersRefreshTask = orderApi.listMyOrders().then(items => {
      store.saveOrders(items)
      this.allOrders = items
      this.ordersRefreshedAt = Date.now()
      this.applyFilter(this.data.filter, resetPage)
    }).catch(() => {}).finally(() => { this.ordersRefreshTask = null })
    return this.ordersRefreshTask
  },
  filterOrders(filter) {
    const orders = Array.isArray(this.allOrders) ? this.allOrders : []
    if (filter === 'active') return orders.filter(item => !['completed', 'cancelled'].includes(item.status))
    if (filter === 'done') return orders.filter(item => item.status === 'completed')
    if (filter === 'after') return orders.filter(item => ['cancelled', 'disputed'].includes(item.status))
    return orders
  },
  applyFilter(filter, resetPage) {
    this.filteredOrders = this.filterOrders(filter)
    this.currentPage = resetPage ? 1 : (this.currentPage || 1)
    const result = paginate(this.filteredOrders, this.currentPage, 20)
    this.pendingOrders = result.items
    renderRecycleData(this, this.recycleContext, result.items, {
      filter, listTotal: result.items.length, hasMore: result.hasMore, loading: false
    })
  },
  setFilter(event) { this.applyFilter(event.currentTarget.dataset.value || 'all', true) },
  loadMore() {
    if (!this.data.hasMore) return
    this.currentPage += 1
    this.applyFilter(this.data.filter, false)
  },
  onPullDownRefresh() { this.refresh({ resetPage: true, force: true }).finally(() => wx.stopPullDownRefresh()) },
  openOrder(event) {
    const id = event.detail && event.detail.id
    if (id) wx.navigateTo({ url: `${ROUTES.orderDetail}?id=${encodeURIComponent(id)}&role=user` })
  },
  goLogin() { wx.reLaunch({ url: ROUTES.welcome }) }
})
