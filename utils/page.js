const { reportError } = require('./errors')
const theme = require('./theme')

function sameDataValue(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  try { return JSON.stringify(left) === JSON.stringify(right) } catch (error) { return false }
}

function createPage(definition) {
  const source = definition && typeof definition === 'object' ? definition : {}
  const originalLoad = source.onLoad
  const originalShow = source.onShow
  const originalHide = source.onHide
  const originalUnload = source.onUnload
  const originalError = source.onError

  // 初始就带上当前主题的变量，避免切页首帧按系统主题渲染（手动主题覆盖系统时闪黑/闪白）
  source.data = Object.assign({
    pageMetaStyle: theme.getPageMetaStyle(),
    pageBackgroundColor: theme.getPageBackgroundColor()
  }, source.data || {})
  source.$applyTheme = function $applyTheme() {
    const pageMetaStyle = theme.getPageMetaStyle()
    const pageBackgroundColor = theme.getPageBackgroundColor()
    if (this.data && this.data.pageMetaStyle === pageMetaStyle && this.data.pageBackgroundColor === pageBackgroundColor) return false
    this.setData({ pageMetaStyle, pageBackgroundColor })
    // 主题切换时同步刷 tabBar（它在 page 之外，拿不到 page-meta 注入的变量）
    this.$syncTabBar()
    return true
  }
  source.$syncTabBar = function $syncTabBar() {
    try {
      const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null
      if (tabBar && typeof tabBar.sync === 'function') tabBar.sync()
    } catch (error) {}
  }
  source.$setDataChanged = function $setDataChanged(patch, callback) {
    const sourcePatch = patch && typeof patch === 'object' ? patch : {}
    const changed = {}
    Object.keys(sourcePatch).forEach(key => {
      if (!sameDataValue(this.data && this.data[key], sourcePatch[key])) changed[key] = sourcePatch[key]
    })
    if (!Object.keys(changed).length) {
      if (typeof callback === 'function') callback()
      return false
    }
    this.setData(changed, callback)
    return true
  }

  source.onLoad = function onLoad(query) {
    this.__managedTimers = new Set()
    this.__hideDisposers = new Set()
    this.__unloadDisposers = new Set()
    theme.applyChrome()
    this.$applyTheme()
    if (typeof originalLoad === 'function') return originalLoad.call(this, query || {})
  }
  source.$setTimeout = function $setTimeout(callback, delay) {
    const timer = setTimeout(() => {
      this.__managedTimers.delete(timer)
      callback()
    }, Math.max(0, Number(delay) || 0))
    this.__managedTimers.add(timer)
    return timer
  }
  source.$addDisposer = function $addDisposer(disposer) {
    if (typeof disposer === 'function') this.__hideDisposers.add(disposer)
    return disposer
  }
  source.$addUnloadDisposer = function $addUnloadDisposer(disposer) {
    if (typeof disposer === 'function') this.__unloadDisposers.add(disposer)
    return disposer
  }
  source.$cleanup = function $cleanup(includeUnload) {
    ;(this.__managedTimers || []).forEach(timer => clearTimeout(timer))
    ;(this.__hideDisposers || []).forEach(disposer => {
      try { disposer() } catch (error) { reportError(error, 'page-disposer', { silent: true }) }
    })
    if (includeUnload) {
      ;(this.__unloadDisposers || []).forEach(disposer => {
        try { disposer() } catch (error) { reportError(error, 'page-unload-disposer', { silent: true }) }
      })
    }
    if (this.__managedTimers) this.__managedTimers.clear()
    if (this.__hideDisposers) this.__hideDisposers.clear()
    if (includeUnload && this.__unloadDisposers) this.__unloadDisposers.clear()
  }
  source.onShow = function onShow() {
    theme.applyChrome()
    this.$applyTheme()
    const result = typeof originalShow === 'function' ? originalShow.call(this) : undefined
    this.$syncTabBar()
    return result
  }
  source.onHide = function onHide() {
    this.$cleanup(false)
    if (typeof originalHide === 'function') return originalHide.call(this)
  }
  source.onUnload = function onUnload() {
    this.$cleanup(true)
    if (typeof originalUnload === 'function') return originalUnload.call(this)
  }
  source.onError = function onError(error) {
    reportError(error, `page:${this.route || 'unknown'}`)
    if (typeof originalError === 'function') return originalError.call(this, error)
  }
  Page(source)
}

module.exports = createPage
