// 主题：默认跟随系统，支持「跟随系统 / 浅色 / 深色」三选。
// 变量值与 styles/variables.wxss 严格保持一致（改一处要同步另一处）。
const PREF_KEY = 'campus_theme'
// 窗口底色在下面几处也各写了一份，改色时要一起改：
// getPageBackgroundColor() / applyChrome() -> wx.setBackgroundColor() / theme.json
const CHROME_LIGHT_BG = '#F1F5FC'
const CHROME_DARK_BG = '#0F1522'
const CHROME_DARK_NAV = '#1A2234'
let cachedPreference = ''
let cachedSystemTheme = ''
const appliedChromeThemes = new Map()

const LIGHT_VARS = {
  '--color-bg': '#F1F5FC',
  '--color-surface': '#FFFFFF',
  '--color-surface-2': '#E8EEF8',
  '--color-divider': '#D8E2F0',
  '--color-tabbar': 'rgba(248, 251, 255, 0.92)',
  '--color-text': '#16233B',
  '--color-text-2': 'rgba(22, 35, 59, 0.62)',
  '--color-muted': 'rgba(22, 35, 59, 0.45)',
  '--color-hint': 'rgba(22, 35, 59, 0.34)',
  '--color-primary': '#3478F6',
  '--color-primary-soft': '#E4EDFD',
  '--color-on-accent': '#FFFFFF',
  '--color-success': '#109068',
  '--color-success-soft': '#E3F2EE',
  '--color-warning': '#E8890C',
  '--color-warning-soft': '#FFF1E5',
  '--color-danger': '#D64545',
  '--color-danger-soft': '#FDECEC',
  '--color-purple': '#7058C8',
  '--color-purple-soft': '#ECE9FA',
  '--color-gray-soft': '#E9EFF8',
  '--color-tabbar-indicator': '#E4EDFD',
  '--color-warm': '#C97A0A',
  '--shadow-color': 'rgba(30, 58, 110, 0.16)',
  '--color-ink': '#16233B',
  '--border-ink-width': '2rpx',
  '--shadow-sticker': '0 6rpx 0 rgba(22, 35, 59, 0.9)',
  '--color-primary-deep': '#1D5BD8',
  '--color-info': '#0E8A8A',
  '--color-info-soft': '#E4F5F5',
  '--tab-active-icon-filter': 'brightness(0) saturate(100%)'
}

const DARK_VARS = {
  '--color-bg': '#0F1522',
  '--color-surface': '#1A2234',
  '--color-surface-2': '#253048',
  '--color-divider': '#36435E',
  '--color-tabbar': 'rgba(21, 28, 44, 0.92)',
  '--color-text': '#F0F5FE',
  '--color-text-2': 'rgba(240, 245, 254, 0.66)',
  '--color-muted': 'rgba(240, 245, 254, 0.48)',
  '--color-hint': 'rgba(240, 245, 254, 0.36)',
  '--color-primary': '#5E93F8',
  '--color-primary-soft': 'rgba(94, 147, 248, 0.24)',
  '--color-on-accent': '#FFFFFF',
  '--color-success': '#3CC08F',
  '--color-success-soft': 'rgba(60, 192, 143, 0.22)',
  '--color-warning': '#FFB340',
  '--color-warning-soft': 'rgba(255, 179, 64, 0.18)',
  '--color-danger': '#FF6B6B',
  '--color-danger-soft': 'rgba(255, 107, 107, 0.2)',
  '--color-purple': '#9A85EC',
  '--color-purple-soft': 'rgba(154, 133, 236, 0.22)',
  '--color-gray-soft': 'rgba(233, 239, 248, 0.14)',
  '--color-tabbar-indicator': 'rgba(94, 147, 248, 0.26)',
  '--color-warm': '#F2A94C',
  '--shadow-color': 'rgba(0, 0, 0, 0.5)',
  '--color-ink': '#E2EBFA',
  '--border-ink-width': '2rpx',
  '--shadow-sticker': '0 6rpx 0 rgba(0, 0, 0, 0.45)',
  '--color-primary-deep': '#8AB4FA',
  '--color-info': '#4FBDBD',
  '--color-info-soft': 'rgba(79, 189, 189, 0.2)',
  '--tab-active-icon-filter': 'brightness(0) saturate(100%) invert(100%)'
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
  return resolve() === 'dark' ? CHROME_DARK_BG : CHROME_LIGHT_BG
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
        backgroundColor: dark ? CHROME_DARK_NAV : CHROME_LIGHT_BG,
        animation: { duration: 0, timingFunc: 'linear' }
      })
      appliedChromeThemes.set(pageKey, resolvedTheme)
    }
    // 窗口背景是页面级的：切 tab 到新页面必须重设，否则回落 theme.json 的 @backgroundColor
    // （只跟系统、不跟手动主题），手动浅色 + 系统深色时切页会露一帧黑。幂等，重复设无副作用。
    wx.setBackgroundColor({
      backgroundColor: dark ? CHROME_DARK_BG : CHROME_LIGHT_BG,
      backgroundColorTop: dark ? CHROME_DARK_BG : CHROME_LIGHT_BG,
      backgroundColorBottom: dark ? CHROME_DARK_BG : CHROME_LIGHT_BG
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
