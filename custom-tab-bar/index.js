const { ROUTES } = require('../config/constants')
const modeStore = require('../utils/mode')
const theme = require('../utils/theme')

const TAB_ROUTES = {
  user: { home: ROUTES.home, orders: ROUTES.orders, profile: ROUTES.profile },
  rider: { hall: ROUTES.riderHall, tasks: ROUTES.riderTasks, profile: ROUTES.profile }
}
// Keep the current, visible tab bar on screen just long enough for its
// compositor-only capsule motion to be seen before switchTab swaps instances.
const NAVIGATION_COMMIT_MS = 130

function indexOfTab(mode, active) {
  const order = mode === 'rider' ? ['hall', 'tasks', 'profile'] : ['home', 'orders', 'profile']
  const index = order.indexOf(active)
  return index < 0 ? 0 : index
}

function routeState() {
  try {
    const pages = getCurrentPages()
    const route = pages.length ? pages[pages.length - 1].route : ''
    if (route === ROUTES.home.slice(1)) return { mode: 'user', active: 'home' }
    if (route === ROUTES.orders.slice(1)) return { mode: 'user', active: 'orders' }
    if (route === ROUTES.riderHall.slice(1)) return { mode: 'rider', active: 'hall' }
    if (route === ROUTES.riderTasks.slice(1)) return { mode: 'rider', active: 'tasks' }
    if (route === ROUTES.profile.slice(1)) return { mode: modeStore.getMode(), active: 'profile' }
  } catch (_) {}
  return null
}

Component({
  data: {
    mode: 'user',
    active: 'home',
    visualActive: 'home',
    indicatorIndex: 0,
    instant: true,
    themeStyle: theme.getTabBarStyle()
  },
  lifetimes: {
    attached() {
      // 首次渲染前就按当前路由定位，避免 show 时才 setData 触发二次滑动
      const state = routeState()
      if (!state) return
      const mode = state.mode === 'rider' ? 'rider' : 'user'
      const active = String(state.active || '')
      this.setData({ mode, active, visualActive: active, indicatorIndex: indexOfTab(mode, active) })
    }
  },
  pageLifetimes: {
    show() {
      this.sync()
    },
    hide() {
      if (!this._navigationTimer) return
      clearTimeout(this._navigationTimer)
      this._navigationTimer = null
      this._navigating = false
    }
  },
  methods: {
    applyTheme() {
      const style = theme.getTabBarStyle()
      if (this.data.themeStyle !== style) this.setData({ themeStyle: style })
    },
    sync(explicitState) {
      this.applyTheme()
      const next = explicitState && explicitState.mode && explicitState.active ? explicitState : routeState()
      if (!next) return
      const mode = next.mode === 'rider' ? 'rider' : 'user'
      const active = String(next.active || '')
      const targetIndex = indexOfTab(mode, active)

      const alreadySynced = this.data.mode === mode && this.data.active === active &&
        this.data.visualActive === active && this.data.indicatorIndex === targetIndex
      this._navigating = false
      if (alreadySynced) return

      // 定位必须瞬移：先关动画再位移。同帧改 transition+transform 可能被 WebView 漏掉、
      // 沿用上一次 transition 播放，导致偶发二次滑动。
      const commit = () => this.setData({ mode, active, visualActive: active, indicatorIndex: targetIndex })
      if (this.data.instant) commit()
      else this.setData({ instant: true }, commit)
    },
    navigate(event) {
      const key = event.currentTarget.dataset.key
      if (!key || key === this.data.active || this._navigating) return
      const routeMap = TAB_ROUTES[this.data.mode] || TAB_ROUTES.user
      const url = routeMap[key]
      if (!url) return
      const from = indexOfTab(this.data.mode, this.data.active)
      const to = indexOfTab(this.data.mode, key)
      modeStore.setMode(this.data.mode)
      this._navigating = true
      // 先让胶囊 transition 生效，再触发位移，保证滑动动画；sync 定位则用 instant 瞬移，
      // 避免切回已缓存实例时把 navigate 留下的中间状态“滑”回去（二次滑动）。
      this.setData({ instant: false }, () => {
        this.setData({ indicatorIndex: to, visualActive: key }, () => {
          this._navigationTimer = setTimeout(() => {
            this._navigationTimer = null
            wx.switchTab({
              url,
              success: () => {
                this._navigating = false
                // 旧实例已隐藏，把 instant 复位回 true，避免下次 show 时 sync 再翻 transition
                this.setData({ instant: true })
              },
              fail: () => {
                this._navigating = false
                this.setData({ instant: true, indicatorIndex: from, visualActive: this.data.active })
              }
            })
          }, NAVIGATION_COMMIT_MS)
        })
      })
    }
  }
})
