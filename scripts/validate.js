const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const errors = []
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8').replace(/^\uFEFF/, ''))
if (app.usingComponents && Object.keys(app.usingComponents).length) errors.push('Global usingComponents must stay empty; declare components per page')
const requiredTabPages = [
  'pages/user/home/home',
  'pages/user/orders/orders',
  'pages/user/profile/profile',
  'pages/rider/hall/hall',
  'pages/rider/tasks/tasks'
]
const configuredTabPages = app.tabBar && Array.isArray(app.tabBar.list) ? app.tabBar.list.map(item => item.pagePath) : []
if (!app.tabBar || app.tabBar.custom !== true) errors.push('Native custom tabBar must stay enabled')
if (JSON.stringify(configuredTabPages) !== JSON.stringify(requiredTabPages)) errors.push('Custom tabBar must declare the five main pages in the expected order')
for (const file of ['index.js', 'index.json', 'index.wxml', 'index.wxss']) {
  if (!fs.existsSync(path.join(root, 'custom-tab-bar', file))) errors.push(`Missing custom-tab-bar/${file}`)
}
const routes = [...app.pages]
for (const pack of app.subPackages || []) for (const page of pack.pages || []) routes.push(`${pack.root}/${page}`)
for (const route of routes) {
  for (const ext of ['js','json','wxml','wxss']) {
    if (!fs.existsSync(path.join(root, `${route}.${ext}`))) errors.push(`Missing ${route}.${ext}`)
  }
  const pageConfigPath = path.join(root, `${route}.json`)
  if (fs.existsSync(pageConfigPath)) {
    const pageConfig = JSON.parse(fs.readFileSync(pageConfigPath, 'utf8').replace(/^\uFEFF/, ''))
    const pageWxml = fs.readFileSync(path.join(root, `${route}.wxml`), 'utf8')
    for (const [componentName, componentPath] of Object.entries(pageConfig.usingComponents || {})) {
      if (!pageWxml.includes(`<${componentName}`)) errors.push(`Unused page component ${componentName} in ${route}`)
      if (typeof componentPath !== 'string' || componentPath.indexOf('plugin://') === 0) continue
      const resolved = componentPath.startsWith('/')
        ? path.join(root, componentPath.slice(1))
        : path.resolve(path.dirname(pageConfigPath), componentPath)
      if (!fs.existsSync(`${resolved}.json`)) errors.push(`Missing component ${componentPath} used by ${route}`)
    }
  }
}
if (app.lazyCodeLoading !== 'requiredComponents') errors.push('lazyCodeLoading must be requiredComponents')

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  if (fs.statSync(dir).isFile()) return [dir]
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => entry.isDirectory() ? walk(path.join(dir,entry.name)) : [path.join(dir,entry.name)])
}
const assets = [path.join(root,'assets'),path.join(root,'packages')].flatMap(walk).filter(file => /\.(png|jpe?g|gif|webp|svg)$/i.test(file))
const sourceFiles = ['app.js','app.json','pages','packages','components','custom-tab-bar','utils','config'].flatMap(item => walk(path.join(root,item))).filter(file => /\.(js|json|wxml|wxss)$/.test(file))
const sourceText = sourceFiles.map(file => fs.readFileSync(file,'utf8')).join('\n')
const pageJavaScript = routes.map(route => path.join(root, `${route}.js`)).filter(fs.existsSync)
for (const file of pageJavaScript) {
  const code = fs.readFileSync(file, 'utf8')
  if (!code.includes('createPage(')) errors.push(`Page must use lifecycle wrapper: ${path.relative(root, file)}`)
  if (/\bsetInterval\s*\(/.test(code)) errors.push(`Unmanaged interval found: ${path.relative(root, file)}`)
}
for (const file of sourceFiles.filter(file => file.endsWith('.js'))) {
  const relative = path.relative(root, file).replace(/\\/g, '/')
  const code = fs.readFileSync(file, 'utf8')
  if (relative !== 'utils/request.js' && /\bwx\.request\s*\(/.test(code)) errors.push(`Raw wx.request found outside request layer: ${relative}`)
}
const forbiddenComponentTagSelector = /(^|[,\s>+~])(?:view|text|button|image|input|picker|scroll-view)(?=[.#:\s>+~,{])/m
for (const file of ['components', 'custom-tab-bar'].flatMap(item => walk(path.join(root, item))).filter(file => file.endsWith('.wxss'))) {
  const code = fs.readFileSync(file, 'utf8')
  if (forbiddenComponentTagSelector.test(code)) errors.push(`Tag selector is not allowed in component WXSS: ${path.relative(root, file)}`)
}
const reviewModeIncomeGuards = [
  ['packages/order/detail/detail.wxml', "role==='rider' && !reviewMode"],
  ['components/order-list-item/order-list-item.wxml', 'wx:if="{{!reviewMode}}"'],
  ['pages/rider/hall/hall.wxml', 'review-mode="{{reviewMode}}"'],
  ['pages/rider/hall/hall.js', "this.data.reviewMode ? ''"],
  ['packages/account/wallet/wallet.wxml', 'wx:if="{{!reviewMode}}"'],
  ['packages/account/coupons/coupons.wxml', 'wx:if="{{!reviewMode}}"']
]
for (const [relative, guard] of reviewModeIncomeGuards) {
  const code = fs.readFileSync(path.join(root, relative), 'utf8')
  if (!code.includes(guard)) errors.push(`Review mode income guard missing: ${relative}`)
}
const profileMarkup = fs.readFileSync(path.join(root, 'pages/user/profile/profile.wxml'), 'utf8')
if (!profileMarkup.includes("wx:if=\"{{mode==='rider' && user.riderApproved}}\" class=\"level-panel\"")) {
  errors.push('Rider level panel must only be visible in rider profile mode')
}
if (!profileMarkup.includes('每笔订单完成后获得10经验，收入仍需经过24小时售后观察期')) {
  errors.push('Rider experience copy must distinguish completion rewards from income settlement')
}
const profileCode = fs.readFileSync(path.join(root, 'pages/user/profile/profile.js'), 'utf8')
if (!profileCode.includes("mode === 'rider' && user.riderApproved") || !profileCode.includes('orderApi.getCurrentUser()')) {
  errors.push('Rider profile must refresh current experience without exposing the level panel in user mode')
}
if (!profileCode.includes("mode !== 'rider'") || !profileCode.includes('PROFILE_FRESH_MS')) {
  errors.push('Profile must skip hidden coupon requests in rider mode and throttle repeated refreshes')
}
const riderHallMarkup = fs.readFileSync(path.join(root, 'pages/rider/hall/hall.wxml'), 'utf8')
if (riderHallMarkup.includes('level-card') || riderHallMarkup.includes('riderProgress.')) {
  errors.push('Rider hall must not display rider level or experience details')
}
const riderApplicationMarkup = fs.readFileSync(path.join(root, 'packages/account/rider-apply/rider-apply.wxml'), 'utf8')
if (riderApplicationMarkup.includes('riderLevel') || riderApplicationMarkup.includes('Lv{{')) {
  errors.push('User-side rider application page must not display rider level details')
}
const riderHallCode = fs.readFileSync(path.join(root, 'pages/rider/hall/hall.js'), 'utf8')
if (!riderHallCode.includes('getListViewport(394)')) errors.push('Rider hall viewport must include the taller floating tab-bar clearance')
for (const [route, offset] of [['pages/user/orders/orders',284],['pages/rider/tasks/tasks',309],['pages/rider/hall/hall',394]]) {
  const code = fs.readFileSync(path.join(root,route+'.js'),'utf8')
  const style = fs.readFileSync(path.join(root,route+'.wxss'),'utf8')
  if (!code.includes(`getListViewport(${offset})`) || !style.includes(`100vh - ${offset}rpx`)) errors.push(`${route}: JS and WXSS list heights must match the floating tab bar`)
}
if (!riderHallMarkup.includes('bindtap="manualRefresh"') || !riderHallMarkup.includes("refreshing?'刷新中':'刷新'")) {
  errors.push('Rider hall must provide a visible manual refresh button with progress feedback')
}
if (!riderHallCode.includes('manualRefresh()') || !riderHallCode.includes('if (this.refreshTask) return this.refreshTask')) {
  errors.push('Rider hall manual refresh must reuse and coalesce the existing hall request')
}
if (!riderHallCode.includes('this.refreshTask = null') || !riderHallCode.includes('this.setData({ refreshing: false })')) {
  errors.push('Rider hall manual refresh must always clear its busy state')
}
const appTabbarCode = fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8')
if (appTabbarCode.includes('wx.reLaunch') || appTabbarCode.includes('wx.redirectTo') || appTabbarCode.includes('wx.setStorageSync')) {
  errors.push('Custom tabbar must use switchTab without synchronous storage writes')
}
if (!appTabbarCode.includes('wx.switchTab') || !appTabbarCode.includes('visualActive: key')) {
  errors.push('Custom tabbar must render immediate selection feedback before switching')
}
if (!appTabbarCode.includes('NAVIGATION_COMMIT_MS = 130') || !appTabbarCode.includes('this._navigationTimer = setTimeout')) {
  errors.push('Custom tabbar must visibly settle the current capsule before switching independent tab instances')
}
if (appTabbarCode.includes('wx.nextTick(') || appTabbarCode.includes('INDICATOR_FRAME_DELAY_MS') || appTabbarCode.includes('indicatorMotion')) {
  errors.push('Custom tabbar indicator must not rely on same-paint state transitions or timing guesses')
}
const appTabbarStyle = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxss'), 'utf8')
if (appTabbarStyle.includes('.tab-indicator { transition: none; animation: none')) {
  errors.push('Reduced-motion mode must retain the short capsule wayfinding animation')
}
if (!appTabbarStyle.includes('transition: transform 130ms')) {
  errors.push('Custom tabbar capsule must retain the smooth 130ms transform transition')
}
if (sourceText.includes('<app-tabbar') || sourceText.includes('/components/app-tabbar/app-tabbar')) {
  errors.push('Legacy per-page app-tabbar must not be restored')
}
const riderTasksCode = fs.readFileSync(path.join(root, 'pages/rider/tasks/tasks.js'), 'utf8')
if (!riderTasksCode.includes('if (this.refreshTask) return this.refreshTask') || !riderTasksCode.includes('this.refreshTask = null')) {
  errors.push('Rider tasks refresh must coalesce concurrent requests')
}
if (!riderTasksCode.includes('TASKS_FRESH_MS') || !riderTasksCode.includes('force: true')) {
  errors.push('Rider tasks must throttle tab revisits while preserving forced pull-down refresh')
}
const userOrdersCode = fs.readFileSync(path.join(root, 'pages/user/orders/orders.js'), 'utf8')
if (!userOrdersCode.includes('ORDERS_FRESH_MS') || !userOrdersCode.includes('force: true')) {
  errors.push('User orders must throttle tab revisits while preserving forced pull-down refresh')
}
const userHomeCode = fs.readFileSync(path.join(root, 'pages/user/home/home.js'), 'utf8')
if (!userHomeCode.includes('HOME_FRESH_MS') || !userHomeCode.includes('this.homeRefreshedAt = Date.now()')) {
  errors.push('User home must avoid immediate duplicate refreshes after tab revisits')
}
const orderDetailCode = fs.readFileSync(path.join(root, 'packages/order/detail/detail.js'), 'utf8')
const detailImageLoader = orderDetailCode.slice(orderDetailCode.indexOf('  loadOrderImages('), orderDetailCode.indexOf('  hydrateImages('))
const detailMetadataIndex = detailImageLoader.indexOf('this.renderOrder(current, role)')
const detailPrivacyIndex = detailImageLoader.indexOf('if (!getPrivacyState(order, role).sensitiveVisible)')
const detailDownloadIndex = detailImageLoader.indexOf('this.hydrateImages(')
if (!detailImageLoader.includes('withoutPrivateImages(order)') || detailMetadataIndex < 0 || detailPrivacyIndex <= detailMetadataIndex || detailDownloadIndex <= detailPrivacyIndex) {
  errors.push('Order detail must render metadata before downloading privacy-gated images')
}
const contentSecurityCode = fs.readFileSync(path.join(root, 'utils/content-security.js'), 'utf8')
if (!contentSecurityCode.includes('Math.min(3, paths.length)') || !contentSecurityCode.includes('async function worker()')) {
  errors.push('Image security checks must retain bounded concurrency')
}
const authCode = fs.readFileSync(path.join(root, 'utils/mini-auth.js'), 'utf8')
if (!authCode.includes('Promise.all([loginTask, resolveBootstrapOptions(options)])')) {
  errors.push('Cold-start login and settings readiness must remain parallelized')
}
const pageManagerCode = fs.readFileSync(path.join(root, 'utils/page.js'), 'utf8')
if (!pageManagerCode.includes('this.data.pageMetaStyle === pageMetaStyle')) {
  errors.push('Page theme application must skip unchanged setData calls')
}
if (!pageManagerCode.includes('$setDataChanged') || !pageManagerCode.includes('$syncTabBar')) {
  errors.push('Page lifecycle must retain changed-data rendering and custom tabbar synchronization')
}
const themeCode = fs.readFileSync(path.join(root, 'utils/theme.js'), 'utf8')
if (!themeCode.includes('const appliedChromeThemes = new Map()') || !themeCode.includes('appliedChromeThemes.get(pageKey)')) {
  errors.push('Native navigation-bar theme cache must be scoped per page')
}
if (themeCode.includes('appliedChromeTheme !== resolvedTheme')) {
  errors.push('Native navigation-bar theme must not be guarded by one global theme value')
}
const storeCode = fs.readFileSync(path.join(root, 'utils/store.js'), 'utf8')
if (!storeCode.includes('let cachedUser') || !storeCode.includes('let cachedOrders') || !storeCode.includes('let cachedSettings')) {
  errors.push('Hot local user, order and settings reads must retain their in-memory cache')
}
const recycleCode = fs.readFileSync(path.join(root, 'utils/recycle-list.js'), 'utf8')
if (!recycleCode.includes('__campusListSignature') || !recycleCode.includes('changedPatch')) {
  errors.push('Recycle lists must skip identical list and metadata renders')
}
const createOrderCode = fs.readFileSync(path.join(root, 'packages/order/create/create.js'), 'utf8')
const createOrderMarkup = fs.readFileSync(path.join(root, 'packages/order/create/create.wxml'), 'utf8')
if (/redirectTo[^\n]+\),\s*(?:500|700)\)/.test(createOrderCode)) {
  errors.push('Order success navigation must not retain artificial 500-700ms delays')
}
if (!createOrderCode.includes('ITEM_PRICES') || !createOrderCode.includes('orderDiscount(bundleBase, pricing)')) {
  errors.push('Normal order page must retain card-based item pricing')
}
if (!createOrderCode.includes('viewSizeGuide()') || !sourceText.includes('/packages/order/assets/size-guide.jpg')) {
  errors.push('Normal order page must retain the parcel size guide entry and image')
}
if (!createOrderCode.includes('{ threshold: 5, amount: 0.5 }') || !createOrderCode.includes('{ threshold: 10, amount: 1 }') || !createOrderCode.includes('{ threshold: 20, amount: 3 }')) {
  errors.push('Normal order page must retain all three confirmed bundle-discount tiers')
}
if (!createOrderCode.includes("const URGENCY_FEES = { today: 0, urgent: 4 }") || !createOrderCode.includes("const DELIVERY_FEES = { downstairs: 0, door: 1, upperFloorDoor: 1.5 }") || !createOrderCode.includes('const BUILDING_9_FEE = 0.5')) {
  errors.push('Normal order page must retain the confirmed whole-order urgency and door fees')
}
if (!createOrderCode.includes('function doorFeeFor(user, pricing)') || !createOrderCode.includes('if (isBuilding9(user)) return pricing.doorFee') || !createOrderCode.includes('dormFloor(user && user.room) >= 4 ? pricing.upperFloorDoorFee : pricing.doorFee')) {
  errors.push('Normal order page must retain the building-9 and floor-based door fee rules')
}
if (!createOrderCode.includes('const bundleBase = Number((subtotal + urgencyFee + deliveryFee + buildingFee).toFixed(2))') || !createOrderCode.includes('bundleBase - Math.min(discount.amount, bundleBase)')) {
  errors.push('Normal order bundle discounts must include all service fees before coupon selection')
}
if (!createOrderCode.includes("items: this.data.cards.map(card => ({ image: card.image, scope: card.scope, size: card.size }))") || !createOrderCode.includes('orderApi.createOrder({')) {
  errors.push('Card-based frontend must submit one image, scope and size per parcel through the order API')
}
if (!createOrderCode.includes('inputNote(event)') || !createOrderCode.includes("note: this.note || ''") || !createOrderMarkup.includes('maxlength="100"') || !createOrderMarkup.includes('bindinput="inputNote"')) {
  errors.push('Normal itemized order page must preserve the optional 100-character order note')
}
if (!createOrderCode.includes('TARGET_PRICING_VERSION = 3') || !createOrderCode.includes('couponId: this.data.selectedCouponId')) {
  errors.push('Itemized pricing requests must preserve the selected coupon and pricing contract version')
}
const normalSubmitStart = createOrderCode.indexOf('  submit() {')
const normalCreateStart = createOrderCode.indexOf('  createOrder() {', normalSubmitStart)
const normalSubmitCode = normalSubmitStart >= 0 && normalCreateStart > normalSubmitStart ? createOrderCode.slice(normalSubmitStart, normalCreateStart) : ''
const forbiddenPricingGate = /pricingReady|priceReady|等待(?:新)?价格启用|等待(?:服务端|后端)启用|暂(?:未开放|不可)提交|不会创建订单/
if (!normalSubmitCode || forbiddenPricingGate.test(`${createOrderCode}\n${createOrderMarkup}`) || /TARGET_PRICING_VERSION|pricingVersion|this\.data\.pricing/.test(normalSubmitCode)) {
  errors.push('Normal order submission must not be blocked by a frontend-only pricing or version gate')
}
if (createOrderCode.includes('wx.request(')) errors.push('Order page must use the shared order API instead of raw wx.request')
const orderApiCode = fs.readFileSync(path.join(root, 'utils/order-api.js'), 'utf8')
if (!orderApiCode.includes('items.map((item, index) => ({ scope: item.scope, size: item.size, uploadId: uploadIds[index] }))')) {
  errors.push('Order API must preserve the one-to-one mapping between item cards and uploaded screenshots')
}
if (!orderApiCode.includes('pricingVersion: Math.max(0, Math.floor(Number(input.pricingVersion) || 0))') || !orderApiCode.includes('quotedTotal: Math.max(0, Number(input.quotedTotal) || 0)')) {
  errors.push('Itemized order API must send its pricing contract version and quoted total')
}
const samplePageCode = fs.readFileSync(path.join(root, 'packages/order/sample/sample.wxml'), 'utf8')
if (!samplePageCode.includes('<image class="sample-image"') || samplePageCode.includes('<safe-image class="sample-image"')) {
  errors.push('Static pickup sample must use the native image component inside its order subpackage')
}
const reviewModeRegistrationGuards = [
  ['app.js', 'remote && remoteSettings.reviewMode === true'],
  ['utils/mini-auth.js', 'selectBootstrapProfile(localProfile, options)'],
  ['pages/auth/welcome/welcome.wxml', 'wx:if="{{authenticating}}"'],
  ['config/business.js', "building: '1栋'"],
  ['config/business.js', "room: '111'"]
]
for (const [relative, guard] of reviewModeRegistrationGuards) {
  const code = fs.readFileSync(path.join(root, relative), 'utf8')
  if (!code.includes(guard)) errors.push(`Review mode auto-registration guard missing: ${relative}`)
}
const reviewModeOrderSemanticsGuards = [
  ['pages/user/home/home.wxml', "reviewMode ? '添加取件凭证，登记一条快递信息'"],
  ['pages/user/home/home.js', 'reviewMode: nextSettings.reviewMode !== false'],
  ['packages/order/create/create.wxml', "reviewMode ? '取件码照片仅用于本次取件核验，不对外展示'"]
]
for (const [relative, guard] of reviewModeOrderSemanticsGuards) {
  const code = fs.readFileSync(path.join(root, relative), 'utf8')
  if (!code.includes(guard)) errors.push(`Review mode order semantics missing: ${relative}`)
}
const authenticationRaceGuards = [
  ['utils/request.js', 'waitForAuthentication(initial)'],
  ['utils/order-api.js', "skipAuth: true"],
  ['pages/auth/welcome/welcome.js', 'Promise.resolve(authentication)'],
  ['pages/user/home/home.js', 'then(() => this.refreshHome())']
]
for (const [relative, guard] of authenticationRaceGuards) {
  const code = fs.readFileSync(path.join(root, relative), 'utf8')
  if (!code.includes(guard)) errors.push(`Authentication readiness guard missing: ${relative}`)
}
for (const asset of assets) {
  const size = fs.statSync(asset).size
  const relativeAsset = path.relative(root, asset).replace(/\\/g, '/')
  // 本地/包内 WebP 在微信小程序 <image> 里不可靠（安卓+iOS 真机均空白），客服二维码与示例图必须保留为 PNG/JPG
  const isRasterRequiredAsset = /^packages\/(?:account\/assets\/admin-wechat(?:-shipai(?:-\d+)?|-(?:gqg|nanhai)(?:-\d+)?)?|order\/assets\/(?:sample-pickup|size-guide))\.(?:png|jpe?g)$/i.test(relativeAsset)
  if (size > 200 * 1024) errors.push(`Asset exceeds 200KB: ${relativeAsset} (${size} bytes)`)
  if (/\.(png|jpe?g)$/i.test(asset) && size > 50 * 1024 && !isRasterRequiredAsset) errors.push(`Large image must use WebP: ${relativeAsset}`)
  const reference = `/${relativeAsset}`
  if (!sourceText.includes(reference)) errors.push(`Unused asset: ${reference}`)
}

function bytes(files) { return files.reduce((sum,file) => sum + fs.statSync(file).size,0) }
const mainFiles = ['app.js','app.json','app.wxss','sitemap.json','pages','components','custom-tab-bar','utils','config','styles','assets','miniprogram_npm']
  .flatMap(item => walk(path.join(root,item))).filter(file => !file.includes(`${path.sep}packages${path.sep}`))
const mainBytes = bytes(mainFiles)
if (mainBytes > 2 * 1024 * 1024) errors.push(`Main package exceeds 2MB: ${(mainBytes/1024/1024).toFixed(2)}MB`)
for (const pack of app.subPackages || []) {
  const packageBytes = bytes(walk(path.join(root, pack.root)))
  if (packageBytes > 2 * 1024 * 1024) errors.push(`Subpackage ${pack.name || pack.root} exceeds 2MB: ${(packageBytes/1024/1024).toFixed(2)}MB`)
}
// 前后端校区 id 集合一致（新增校区必须两端同步改）
try {
  const frontendCampuses = require(path.join(root, 'config', 'constants.js')).CAMPUSES || []
  const backendCampuses = require(path.join(root, 'server', 'src', 'campus-config.js')).CAMPUSES || []
  const frontendSet = JSON.stringify([...frontendCampuses].sort())
  const backendSet = JSON.stringify([...backendCampuses].sort())
  if (frontendSet !== backendSet) errors.push(`前后端校区 id 集合不一致：前端 ${frontendSet} / 后端 ${backendSet}`)
} catch (error) {
  errors.push(`校区一致性校验失败：${error.message}`)
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
console.log(`Validation passed: ${routes.length} pages, ${assets.length} images, main package ${(mainBytes/1024).toFixed(1)}KB.`)
