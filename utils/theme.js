// 主题：默认跟随系统，支持「跟随系统 / 浅色 / 深色」三选。
// 变量值与 styles/variables.wxss 严格保持一致（改一处要同步另一处）。
const PREF_KEY = 'campus_theme'
let cachedPreference = ''
let cachedSystemTheme = ''
const appliedChromeThemes = new Map()

const LIGHT_VARS = {
  '--color-bg': '#f2f2f7',
  '--color-surface': '#ffffff',
  '--color-surface-2': '#f2f2f7',
  '--color-divider': '#e5e5ea',
  '--color-tabbar': 'rgba(255, 255, 255, 0.82)',
  '--color-text': '#000000',
  '--color-text-2': 'rgba(60, 60, 67, 0.6)',
  '--color-muted': 'rgba(60, 60, 67, 0.4)',
  '--color-hint': 'rgba(60, 60, 67, 0.3)',
  '--color-primary': '#007aff',
  '--color-primary-soft': 'rgba(0, 122, 255, 0.12)',
  '--color-on-accent': '#ffffff',
  '--color-success': '#34c759',
  '--color-success-soft': 'rgba(52, 199, 89, 0.14)',
  '--color-warning': '#ff9500',
  '--color-warning-soft': 'rgba(255, 149, 0, 0.14)',
  '--color-danger': '#ff3b30',
  '--color-danger-soft': 'rgba(255, 59, 48, 0.12)',
  '--color-purple': '#af52de',
  '--color-purple-soft': 'rgba(175, 82, 222, 0.14)',
  '--color-gray-soft': 'rgba(120, 120, 128, 0.16)',
  '--color-tabbar-indicator': 'rgba(120, 120, 128, 0.28)',
  '--color-warm': '#c93400',
  '--shadow-color': 'rgba(0, 0, 0, 0.08)'
}

const DARK_VARS = {
  '--color-bg': '#000000',
  '--color-surface': '#1c1c1e',
  '--color-surface-2': '#2c2c2e',
  '--color-divider': '#38383a',
  '--color-tabbar': 'rgba(28, 28, 30, 0.82)',
  '--color-text': '#ffffff',
  '--color-text-2': 'rgba(235, 235, 245, 0.6)',
  '--color-muted': 'rgba(235, 235, 245, 0.4)',
  '--color-hint': 'rgba(235, 235, 245, 0.3)',
  '--color-primary': '#0a84ff',
  '--color-primary-soft': 'rgba(10, 132, 255, 0.22)',
  '--color-on-accent': '#ffffff',
  '--color-success': '#30d158',
  '--color-success-soft': 'rgba(48, 209, 88, 0.22)',
  '--color-warning': '#ff9f0a',
  '--color-warning-soft': 'rgba(255, 159, 10, 0.22)',
  '--color-danger': '#ff453a',
  '--color-danger-soft': 'rgba(255, 69, 58, 0.22)',
  '--color-purple': '#bf5af2',
  '--color-purple-soft': 'rgba(191, 90, 242, 0.22)',
  '--color-gray-soft': 'rgba(120, 120, 128, 0.36)',
  '--color-tabbar-indicator': 'rgba(120, 120, 128, 0.48)',
  '--color-warm': '#ff9f0a',
  '--shadow-color': 'rgba(0, 0, 0, 0.55)'
}

const LIGHT_META_STYLE = Object.keys(LIGHT_VARS).map(key => key + ':' + LIGHT_VARS[key]).join(';')
const DARK_META_STYLE = Object.keys(DARK_VARS).map(key => key + ':' + DARK_VARS[key]).join(';')

function getPreference() {
  if (cachedPreference) return cachedPreference
  try {
    const v = wx.getStorageSync(PREF_KEY)
    cachedPreference = v === 'light' || v === 'dark' ? v : 'system'
  } catch (error) {
    cachedPreference = 'system'
  }
  return cachedPreference
}

function setPreference(value) {
  const next = value === 'light' || value === 'dark' ? value : 'system'
  cachedPreference = next
  try { wx.setStorageSync(PREF_KEY, next) } catch (error) {}
  apply()
  return next
}

function getSystemTheme() {
  if (cachedSystemTheme) return cachedSystemTheme
  try {
    let systemTheme = ''
    if (typeof wx.getAppBaseInfo === 'function') systemTheme = (wx.getAppBaseInfo() || {}).theme
    if (!systemTheme && typeof wx.getSystemInfoSync === 'function') systemTheme = (wx.getSystemInfoSync() || {}).theme
    cachedSystemTheme = systemTheme === 'dark' ? 'dark' : 'light'
  } catch (error) {
    cachedSystemTheme = 'light'
  }
  return cachedSystemTheme
}

function resolve() {
  const pref = getPreference()
  if (pref === 'dark') return 'dark'
  if (pref === 'light') return 'light'
  return getSystemTheme()
}

// 手动指定主题时，把变量以内联形式注入 page 根元素（覆盖 @media 跟随系统的结果）。
// 跟随系统时返回空串，交给 @media 决定。
function getPageMetaStyle() {
  const pref = getPreference()
  if (pref === 'system') return ''
  return pref === 'dark' ? DARK_META_STYLE : LIGHT_META_STYLE
}

// 底部导航（custom-tab-bar）渲染在 page 标签之外，拿不到 page{} 上的变量，
// 需要把当前主题的变量内联注入到 tabBar 根节点。与 getPageMetaStyle 不同，
// 跟随系统时也返回确定值——tabBar 外面没有 page 可依赖 @media。
function getTabBarStyle() {
  return resolve() === 'dark' ? DARK_META_STYLE : LIGHT_META_STYLE
}

// 窗口背景色（下拉露出 / 切页瞬间露出的底色）。theme.json 的 @backgroundColor 只跟系统，
// 手动主题覆盖系统时切页会露一帧系统色，故每页用 page-meta 的 background-color 覆盖。
function getPageBackgroundColor() {
  return resolve() === 'dark' ? '#000000' : '#f2f2f7'
}

function getCurrentPageKey() {
  try {
    const pages = getCurrentPages() || []
    const current = pages.length ? pages[pages.length - 1] : null
    return current && current.route ? String(current.route) : '__app__'
  } catch (error) {
    return '__app__'
  }
}

// 原生导航栏 / 页面窗口背景跟随主题（系统主题与手动主题统一在这里刷成确定值）。
function applyChrome() {
  const resolvedTheme = resolve()
  const dark = resolvedTheme === 'dark'
  const pageKey = getCurrentPageKey()
  try {
    // 原生导航栏颜色属于当前页面，而不是全局状态。每个缓存 tab 页必须分别应用一次，
    // 否则在“我的”切换主题后，其他 tab 会继续保留系统主题下的旧导航栏颜色。
    if (appliedChromeThemes.get(pageKey) !== resolvedTheme) {
      wx.setNavigationBarColor({
        frontColor: dark ? '#ffffff' : '#000000',
        backgroundColor: dark ? '#1c1c1e' : '#ffffff',
        animation: { duration: 0, timingFunc: 'linear' }
      })
      appliedChromeThemes.set(pageKey, resolvedTheme)
    }
    // 窗口背景是页面级的：切 tab 到新页面必须重设，否则回落 theme.json 的 @backgroundColor
    // （只跟系统、不跟手动主题），手动浅色 + 系统深色时切页会露一帧黑。幂等，重复设无副作用。
    wx.setBackgroundColor({
      backgroundColor: dark ? '#000000' : '#f2f2f7',
      backgroundColorTop: dark ? '#000000' : '#f2f2f7',
      backgroundColorBottom: dark ? '#000000' : '#f2f2f7'
    })
    return true
  } catch (error) {
    return false
  }
}

// 把当前主题刷到所有已打开的页面（重新计算各自 page-meta 的内联变量）。
function apply() {
  applyChrome()
  try {
    const pages = getCurrentPages() || []
    pages.forEach(page => {
      if (page && typeof page.$applyTheme === 'function') page.$applyTheme()
    })
  } catch (error) {}
}

function init() {
  applyChrome()
  if (typeof wx.onThemeChange === 'function') {
    wx.onThemeChange(event => {
      if (event && (event.theme === 'dark' || event.theme === 'light')) cachedSystemTheme = event.theme
      else cachedSystemTheme = ''
      // 仅「跟随系统」时，系统主题变化才联动页面；手动指定时忽略系统变化
      if (getPreference() === 'system') apply()
    })
  }
}

module.exports = { getPreference, setPreference, getSystemTheme, resolve, getPageMetaStyle, getTabBarStyle, getPageBackgroundColor, applyChrome, apply, init }
