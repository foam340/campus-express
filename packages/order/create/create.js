const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const { checkImages } = require('../../../utils/content-security')
const orderApi = require('../../../utils/order-api')
const { ROUTES, dormFloor, getCampusConfig } = require('../../../config/constants')

// 新版逐件计价。界面报价用于即时反馈，创建订单时以后端价格快照为准。
// 单价 fallback 用南海价（后端 /mini/settings 未返回时的兜底）；真实价以后端为准，
// 石牌等校区后端行 campus/off_campus 同值，读 campus 价即正确。
const ITEM_PRICES = {
  small: { label: '小件', campus: 1, off_campus: 2 },
  medium: { label: '中件', campus: 3, off_campus: 4 },
  large: { label: '大件', campus: 5, off_campus: 6 }
}
const ORDER_DISCOUNTS = [
  { threshold: 20, amount: 3 },
  { threshold: 10, amount: 1 },
  { threshold: 5, amount: 0.5 }
]
const URGENCY_FEES = { today: 0, soon: 2, urgent: 4 }
const DELIVERY_FEES = { downstairs: 0, door: 1, upperFloorDoor: 1.5 }
const BUILDING_9_FEE = 0.5
const TARGET_PRICING_VERSION = 3
const MAX_ITEMS = 8

function money(value) {
  return (Math.max(0, Number(value) || 0)).toFixed(2)
}

function safePrice(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function normalizePricing(value) {
  const source = value && typeof value === 'object' ? value : {}
  const pricingVersion = Math.max(0, Math.floor(Number(source.version) || 0))
  // V3 沿用 V2 的校区费率字段，仅调整满减基数，不能因缓存仍为 V2 而退回南海价。
  const activeSource = pricingVersion >= 2 ? source : {}
  const tiers = Array.isArray(activeSource.bundleTiers) ? activeSource.bundleTiers.map(item => ({
    threshold: safePrice(item && item.threshold, -1),
    amount: safePrice(item && item.amount, -1)
  })).filter(item => item.threshold >= 0 && item.amount >= 0).sort((left, right) => right.threshold - left.threshold) : []
  return {
    version: pricingVersion,
    small: { campus: safePrice(activeSource.small && activeSource.small.campus, ITEM_PRICES.small.campus), off_campus: safePrice(activeSource.small && activeSource.small.off_campus, ITEM_PRICES.small.off_campus) },
    medium: { campus: safePrice(activeSource.medium && activeSource.medium.campus, ITEM_PRICES.medium.campus), off_campus: safePrice(activeSource.medium && activeSource.medium.off_campus, ITEM_PRICES.medium.off_campus) },
    large: { campus: safePrice(activeSource.large && activeSource.large.campus, ITEM_PRICES.large.campus), off_campus: safePrice(activeSource.large && activeSource.large.off_campus, ITEM_PRICES.large.off_campus) },
    urgentFee: safePrice(activeSource.urgentFee, URGENCY_FEES.urgent),
    soonFee: safePrice(activeSource.soonFee, URGENCY_FEES.soon),
    doorFee: safePrice(activeSource.doorFee, DELIVERY_FEES.door),
    upperFloorDoorFee: safePrice(activeSource.upperFloorDoorFee, DELIVERY_FEES.upperFloorDoor),
    building9Fee: safePrice(activeSource.building9Fee, BUILDING_9_FEE),
    bundleTiers: tiers.length ? tiers : ORDER_DISCOUNTS
  }
}

function isBuilding9(user) {
  const cfg = getCampusConfig(user && user.campus)
  if (!(cfg && cfg.building9Fee)) return false
  return String(user && user.building || '').trim().replace(/栋$/, '') === '9'
}

// 上门费：9栋用基础上门费；4楼及以上用「高层上门费」；其余用基础上门费。
// 石牌等无「9栋」概念、且 doorFee 与 upperFloorDoorFee 同值的校区，此函数自然退化为固定上门费。
function doorFeeFor(user, pricing) {
  if (isBuilding9(user)) return pricing.doorFee
  return dormFloor(user && user.room) >= 4 ? pricing.upperFloorDoorFee : pricing.doorFee
}

function couponExpiry(item) {
  const expiresAt = Number(item && item.expiresAtMs) || 0
  return expiresAt > 0 ? expiresAt : Number.MAX_SAFE_INTEGER
}

function couponEffectiveDiscount(item, total) {
  return Math.min(Math.max(0, Number(total) || 0), Math.max(0, Number(item && item.amount) || 0))
}

function usableCoupon(item, total, now) {
  return Boolean(item && total > 0 && item.status === 'available' && couponExpiry(item) > now && Number(item.minSpend || 0) <= total)
}

function bestCoupon(coupons, total) {
  return coupons.filter(item => usableCoupon(item, total, Date.now())).sort((left, right) => {
    const discountDifference = couponEffectiveDiscount(right, total) - couponEffectiveDiscount(left, total)
    return discountDifference || couponExpiry(left) - couponExpiry(right)
  })[0] || null
}

function createItem(id, scope) {
  return {
    id,
    image: '',
    scope: scope || 'campus',
    scopeLabel: '',
    size: '',
    sizeLabel: '请选择尺寸',
    price: 0,
    priceText: '0.00',
    complete: false,
    expanded: true
  }
}

function orderDiscount(subtotal, pricing) {
  return pricing.bundleTiers.find(item => subtotal >= item.threshold) || { amount: 0 }
}

createPage({
  data: {
    reviewChecking: true,
    cards: [],
    user: {},
    hasOffCampus: true,
    stations: [],
    pickupStation: '',
    reviewMode: true,
    urgency: 'today',
    deliveryMode: 'downstairs',
    subtotalText: '0.00',
    discountText: '0.00',
    urgencyFeeText: '0.00',
    deliveryFeeText: '0.00',
    buildingFeeText: '0.00',
    urgentOptionFeeText: '4.00',
    soonOptionFeeText: '2.00',
    doorOptionFeeText: '1.00',
    doorOptionHint: '1-3楼',
    originalTotalText: '0.00',
    totalText: '0.00',
    coupons: [],
    couponOptions: [],
    couponsLoaded: false,
    couponRowText: '正在加载',
    couponDiscountText: '0.00',
    selectedCouponId: '',
    selectedCouponName: '',
    showCouponSheet: false,
    isBuilding9: false,
    selectedCount: 0,
    incompleteCount: 1,
    nextDiscountText: '满5减0.5，满10减1，满20减3',
    canAdd: true,
    pricing: normalizePricing(null),
    /* 发布页「细线 + 三点」滚动进度：scrollPct 0~1，pageScrollRange 为可滚动高度 */
    scrollPct: 0,
    pageScrollRange: 0,
    /* 金额翻牌：每次应付金额变化交替 a/b 两套同名动画，使 CSS 动画重新播放 */
    flipTick: 0,
    submitting: false,
    showPayQr: false,
    payQrImage: '',
    orderPayableText: '0.00'
  },
  onLoad() {
    const user = store.getUser() || {}
    const campusCfg = getCampusConfig(user.campus)
    const stations = (campusCfg && campusCfg.stations) || []
    const settings = store.getSettings()
    this.setData({
      hasOffCampus: Boolean(campusCfg && campusCfg.hasOffCampus),
      scopeStations: (campusCfg && campusCfg.scopeStations) || [],
      stations,
      pickupStation: stations.length ? stations[0].value : '',
      reviewMode: settings.reviewMode !== false
    })
    this.applyReviewTitle()
    this.nextItemId = 2
    this.couponMode = 'auto'
    this.manualCouponId = ''
    this.note = ''
    this.refresh([createItem(1, 'campus')], { user, reviewChecking: false })
    this.refreshCoupons(true)
    orderApi.getMiniSettings(user.campus || 'nanhai').then(remoteSettings => {
      const latest = store.setSettings(remoteSettings, user.campus)
      const pricing = normalizePricing(remoteSettings.itemPricing)
      this.setData({ reviewMode: latest.reviewMode !== false })
      this.applyReviewTitle()
      this.refresh(this.data.cards, { pricing })
    }).catch(() => {})
  },
  onShow() {
    if (!this.data.reviewChecking) {
      this.refresh(this.data.cards, { user: store.getUser() || {} })
      this.refreshCoupons(false)
      this.resumePaymentCheck()
    }
  },
  onReady() {
    this.measureScrollRange()
  },
  /* 页面滚动：只把滚动距离换算成 0~1 的 scrollPct 给顶部进度条用，不参与任何业务逻辑 */
  onPageScroll(event) {
    const range = Number(this.data.pageScrollRange) || 0
    const raw = range > 0 ? Number(event.scrollTop) / range : 0
    const pct = Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100
    if (pct !== this.data.scrollPct) this.setData({ scrollPct: pct })
  },
  /* 量一次可滚动高度：页面内容增删后会变化，所以 refresh 之后也会重新量 */
  measureScrollRange() {
    try {
      const info = wx.getSystemInfoSync() || {}
      const windowHeight = Number(info.windowHeight) || 0
      if (!windowHeight) return
      wx.createSelectorQuery().in(this).select('.create-page').boundingClientRect(rect => {
        if (!rect) return
        const range = Math.max(0, Math.round(rect.height - windowHeight))
        if (Math.abs(range - (Number(this.data.pageScrollRange) || 0)) > 1) this.setData({ pageScrollRange: range })
      }).exec()
    } catch (err) {}
  },
  applyReviewTitle() {
    wx.setNavigationBarTitle({ title: this.data.reviewMode ? '校园快递登记' : '发布代拿订单' })
  },
  onReviewModeChanged() {
    this.applyReviewTitle()
    if (this.data.reviewMode && this.data.urgency === 'soon') this.refresh(this.data.cards, { urgency: 'today' })
  },
  refreshCoupons(force) {
    if (this.couponRefreshTask) return this.couponRefreshTask
    if (!force && this.couponsRefreshedAt && Date.now() - this.couponsRefreshedAt < 30 * 1000) return Promise.resolve(this.data.coupons)
    this.couponRefreshTask = orderApi.listCoupons().then(items => {
      this.couponsRefreshedAt = Date.now()
      const coupons = items.map(item => Object.assign({}, item, {
        id: String(item.id || ''),
        amount: Math.max(0, Number(item.amount) || 0),
        minSpend: Math.max(0, Number(item.minSpend) || 0),
        expiresAtMs: Number(item.expiresAtMs) || 0
      }))
      this.refresh(this.data.cards, { coupons, couponsLoaded: true })
      return coupons
    }).catch(() => {
      this.setData({ couponsLoaded: true, couponRowText: '暂时无法加载' })
      return []
    }).finally(() => { this.couponRefreshTask = null })
    return this.couponRefreshTask
  },
  refresh(cards, extra) {
    const nextState = extra || {}
    const pricing = nextState.pricing || this.data.pricing || normalizePricing(null)
    const user = nextState.user || this.data.user || {}
    const coupons = Object.prototype.hasOwnProperty.call(nextState, 'coupons') ? nextState.coupons : (this.data.coupons || [])
    const urgency = ['today', 'soon', 'urgent'].includes(nextState.urgency) ? nextState.urgency : this.data.urgency
    const deliveryMode = nextState.deliveryMode === 'door' ? 'door' : (nextState.deliveryMode === 'downstairs' ? 'downstairs' : this.data.deliveryMode)
    let subtotal = 0
    let selectedCount = 0
    const scopeStations = this.data.scopeStations || []
    const decorated = cards.map(card => {
      const config = ITEM_PRICES[card.size]
      const prices = pricing[card.size]
      const station = scopeStations.find(s => s.value === card.scope) || null
      const scope = station ? station.value : (card.scope === 'off_campus' ? 'off_campus' : 'campus')
      const priceScope = station ? station.priceScope : (card.scope === 'off_campus' ? 'off_campus' : 'campus')
      const price = config && prices ? prices[priceScope] : 0
      if (config) {
        subtotal += price
        selectedCount += 1
      }
      return Object.assign({}, card, {
        scope,
        scopeLabel: station ? station.title : (scope === 'off_campus' ? '校外' : '校内'),
        sizeLabel: config ? config.label : '请选择尺寸',
        price,
        priceText: money(price),
        complete: Boolean(card.image && config)
      })
    })
    const urgencyFee = urgency === 'urgent' ? pricing.urgentFee : urgency === 'soon' ? pricing.soonFee : 0
    const building9 = isBuilding9(user)
    const selectedDoorFee = doorFeeFor(user, pricing)
    const deliveryFee = deliveryMode === 'door' ? selectedDoorFee : 0
    const buildingFee = building9 ? pricing.building9Fee : 0
    // V3：快递费和全部服务费共同凑满减，取最高一档，最后叠加优惠券。
    const bundleBase = Number((subtotal + urgencyFee + deliveryFee + buildingFee).toFixed(2))
    const discount = orderDiscount(bundleBase, pricing)
    const originalTotal = Math.max(0, Number((bundleBase - Math.min(discount.amount, bundleBase)).toFixed(2)))
    const now = Date.now()
    const eligibleCoupons = coupons.filter(item => usableCoupon(item, originalTotal, now))
    let selectedCoupon = null
    if (this.couponMode === 'manual') {
      selectedCoupon = eligibleCoupons.find(item => String(item.id) === String(this.manualCouponId)) || null
      if (!selectedCoupon) this.couponMode = 'auto'
    }
    if (this.couponMode === 'auto') selectedCoupon = bestCoupon(eligibleCoupons, originalTotal)
    const couponDiscount = selectedCoupon ? couponEffectiveDiscount(selectedCoupon, originalTotal) : 0
    const couponOptions = coupons.filter(item => item.status === 'available' && couponExpiry(item) > now).map(item => {
      const eligible = usableCoupon(item, originalTotal, now)
      return Object.assign({}, item, {
        amountText: money(item.amount),
        ruleText: Number(item.minSpend) > 0 ? `满¥${money(item.minSpend)}可用` : '无门槛',
        eligibilityText: eligible ? `可抵¥${money(couponEffectiveDiscount(item, originalTotal))}` : `还差¥${money(Number(item.minSpend) - originalTotal)}`,
        eligible,
        selected: Boolean(selectedCoupon && String(selectedCoupon.id) === String(item.id))
      })
    }).sort((left, right) => Number(right.eligible) - Number(left.eligible) || couponExpiry(left) - couponExpiry(right))
    const incompleteCount = decorated.filter(card => !card.complete).length
    let nextDiscountText = '已享受最高档多件优惠'
    const pendingTiers = pricing.bundleTiers.slice().reverse().filter(item => bundleBase < item.threshold)
    if (pendingTiers.length) {
      const nextTier = pendingTiers[0]
      nextDiscountText = `再选 ¥${money(nextTier.threshold - bundleBase)}，可享满${money(nextTier.threshold)}减${money(nextTier.amount)}`
    }
    this.setData(Object.assign({}, nextState, {
      cards: decorated,
      pricing,
      user,
      coupons,
      couponOptions,
      urgency,
      deliveryMode,
      subtotalText: money(subtotal),
      discountText: money(Math.min(discount.amount, bundleBase)),
      urgencyFeeText: money(urgencyFee),
      deliveryFeeText: money(deliveryFee),
      buildingFeeText: money(buildingFee),
      urgentOptionFeeText: money(pricing.urgentFee),
      soonOptionFeeText: money(pricing.soonFee),
      doorOptionFeeText: money(selectedDoorFee),
      doorOptionHint: building9 ? '9栋有电梯' : (dormFloor(user.room) >= 4 ? '4楼及以上' : '1-3楼'),
      originalTotalText: money(originalTotal),
      couponDiscountText: money(couponDiscount),
      /* 应付金额变化时 flipTick +1，配合 wxml 上 a/b 两套同名动画实现重新播放 */
      flipTick: money(originalTotal - couponDiscount) !== this.data.totalText
        ? (Number(this.data.flipTick) || 0) + 1
        : (Number(this.data.flipTick) || 0),
      selectedCouponId: selectedCoupon ? String(selectedCoupon.id) : '',
      selectedCouponName: selectedCoupon ? selectedCoupon.name : '',
      couponRowText: selectedCoupon ? `已优惠 ¥${money(couponDiscount)}` : (eligibleCoupons.length ? `${eligibleCoupons.length}张可用` : ((Object.prototype.hasOwnProperty.call(nextState, 'couponsLoaded') ? nextState.couponsLoaded : this.data.couponsLoaded) ? '暂无可用' : '正在加载')),
      totalText: money(originalTotal - couponDiscount),
      isBuilding9: building9,
      selectedCount,
      incompleteCount,
      nextDiscountText,
      canAdd: decorated.length < MAX_ITEMS
    }))
    /* 卡片增删后页面高度变了，重新量一次可滚动高度 */
    this.measureScrollRange()
  },
  chooseImage(event) {
    const id = Number(event.currentTarget.dataset.id)
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async result => {
        const file = result && result.tempFiles && result.tempFiles[0]
        if (!file || !file.tempFilePath) return
        const { passed } = await checkImages([file.tempFilePath])
        if (!passed.length) return
        this.refresh(this.data.cards.map(card => card.id === id ? Object.assign({}, card, { image: passed[0] }) : card))
      }
    })
  },
  previewSampleImage() { wx.navigateTo({ url: ROUTES.samplePickup }) },
  viewSizeGuide() { wx.navigateTo({ url: ROUTES.sizeGuide }) },
  /* 超大件提示里的「联系客服 ›」：与「我的」页同一条通道（客服页展示各校区管理员微信号 + 二维码） */
  goService() { if (!this.data.reviewMode) wx.navigateTo({ url: ROUTES.service }) },
  inputNote(event) { this.note = String(event.detail.value || '').slice(0, 100) },
  previewImage(event) {
    const card = this.data.cards.find(item => item.id === Number(event.currentTarget.dataset.id))
    if (card && card.image) wx.previewImage({ current: card.image, urls: [card.image] })
  },
  clearImage(event) {
    const id = Number(event.currentTarget.dataset.id)
    this.refresh(this.data.cards.map(card => card.id === id ? Object.assign({}, card, { image: '', expanded: true }) : card))
  },
  selectScope(event) {
    const id = Number(event.currentTarget.dataset.id)
    const scope = String(event.currentTarget.dataset.value || '')
    if (!(this.data.scopeStations || []).some(item => item.value === scope)) return
    this.refresh(this.data.cards.map(card => card.id === id ? Object.assign({}, card, { scope }) : card))
  },
  selectStation(event) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!this.data.stations.some(item => item.value === value)) return
    this.setData({ pickupStation: value })
  },
  selectSize(event) {
    const id = Number(event.currentTarget.dataset.id)
    const size = String(event.currentTarget.dataset.value || '')
    if (!ITEM_PRICES[size]) return
    this.refresh(this.data.cards.map(card => card.id === id ? Object.assign({}, card, { size }) : card))
  },
  finishCard(event) {
    const id = Number(event.currentTarget.dataset.id)
    const card = this.data.cards.find(item => item.id === id)
    if (!card || !card.image) {
      wx.showToast({ title: '请先上传这件快递的截图', icon: 'none' })
      return
    }
    if (!card.size) {
      wx.showToast({ title: '请选择快递尺寸', icon: 'none' })
      return
    }
    this.refresh(this.data.cards.map(item => item.id === id ? Object.assign({}, item, { expanded: false }) : item))
  },
  editCard(event) {
    const id = Number(event.currentTarget.dataset.id)
    this.refresh(this.data.cards.map(card => Object.assign({}, card, { expanded: card.id === id })))
  },
  removeCard(event) {
    const id = Number(event.currentTarget.dataset.id)
    if (this.data.cards.length === 1) {
      wx.showToast({ title: '订单至少保留一件快递', icon: 'none' })
      return
    }
    wx.showModal({
      title: '删除这件快递？',
      content: '截图和尺寸选择会一起移除。',
      confirmText: '删除',
      confirmColor: '#ff3b30',
      success: result => {
        if (!result.confirm) return
        const cards = this.data.cards.filter(card => card.id !== id)
        if (!cards.some(card => card.expanded)) cards[cards.length - 1] = Object.assign({}, cards[cards.length - 1], { expanded: true })
        this.refresh(cards)
      }
    })
  },
  addCard() {
    if (!this.data.canAdd) {
      wx.showToast({ title: `最多添加${MAX_ITEMS}件`, icon: 'none' })
      return
    }
    const previous = this.data.cards[this.data.cards.length - 1]
    const cards = this.data.cards.map(card => Object.assign({}, card, { expanded: false }))
    cards.push(createItem(this.nextItemId++, previous && previous.scope))
    this.refresh(cards)
  },
  selectUrgency(event) {
    const value = event.currentTarget.dataset.value
    if (this.data.reviewMode && value === 'soon') return
    const urgency = ['today', 'soon', 'urgent'].includes(value) ? value : 'today'
    this.refresh(this.data.cards, { urgency })
  },
  selectDeliveryMode(event) {
    const deliveryMode = event.currentTarget.dataset.value === 'door' ? 'door' : 'downstairs'
    this.refresh(this.data.cards, { deliveryMode })
  },
  openCouponSheet() { if (!this.data.reviewMode) this.setData({ showCouponSheet: true }) },
  closeCouponSheet() { this.setData({ showCouponSheet: false }) },
  selectCoupon(event) {
    const couponId = String(event.currentTarget.dataset.id || '')
    if (couponId === 'none') {
      this.couponMode = 'none'
      this.manualCouponId = ''
    } else {
      const target = this.data.couponOptions.find(item => String(item.id) === couponId)
      if (!target || !target.eligible) return
      this.couponMode = 'manual'
      this.manualCouponId = couponId
    }
    this.refresh(this.data.cards, { showCouponSheet: false })
  },
  editAddress() { wx.navigateTo({ url: `${ROUTES.editProfile}?from=create` }) },
  submit() {
    if (this.data.submitting) return
    if (!store.isRegistrationComplete()) {
      wx.reLaunch({ url: ROUTES.welcome })
      return
    }
    const settings = store.getSettings()
    if (settings.serviceStatus === 'closed') {
      wx.showToast({ title: settings.serviceNotice || '当前暂停接单', icon: 'none' })
      return
    }
    const user = this.data.user || {}
    if (this.data.stations.length && !user.building) {
      wx.showToast({ title: '请先完善收货地址', icon: 'none' })
      return
    }
    if (this.data.incompleteCount > 0) {
      wx.showToast({ title: `还有${this.data.incompleteCount}件未填写完整`, icon: 'none' })
      return
    }
    const stationLabel = (this.data.stations.find(item => item.value === this.data.pickupStation) || {}).label || ''
    const stationLine = stationLabel ? `\n取件：${stationLabel}` : ''
    const urgencyText = this.data.reviewMode ? (this.data.urgency === 'urgent' ? '很急' : '今天取件')
      : this.data.urgency === 'urgent' ? '很急 · 下单后1小时内'
        : this.data.urgency === 'soon' ? '稍急 · 下单后4小时内' : '今天23:00前送达'
    const deliveryLine = this.data.deliveryMode === 'door' ? (this.data.reviewMode ? '宿舍门口' : '送到指定位置门口') : (this.data.reviewMode ? '宿舍楼下' : '送到宿舍楼下')
    wx.showModal({
      title: this.data.reviewMode ? '确认提交登记' : '确认提交订单',
      content: `${this.data.cards.length}件快递 · ${urgencyText}${stationLine}\n${deliveryLine}${this.data.reviewMode ? '' : `\n预计应付 ¥${this.data.totalText}`}`,
      confirmText: '确认提交',
      success: result => {
        if (!result.confirm) return
        this.createOrder()
      }
    })
  },
  createOrder() {
    this.setData({ submitting: true })
    orderApi.createOrder({
      items: this.data.cards.map(card => ({ image: card.image, scope: card.scope, size: card.size })),
      urgency: this.data.urgency,
      toDoor: this.data.deliveryMode === 'door',
      note: this.note || '',
      couponId: this.data.selectedCouponId,
      pricingVersion: TARGET_PRICING_VERSION,
      quotedTotal: this.data.totalText,
      // 有驿站概念的校区随单提交取件驿站与自由地址；无驿站校区传空，后端回落到用户资料地址。
      pickupStation: this.data.stations.length ? this.data.pickupStation : '',
      building: this.data.stations.length ? String((this.data.user || {}).building || '').trim() : '',
      room: this.data.stations.length ? String((this.data.user || {}).room || '').trim() : ''
    }).then(order => {
      if (!order) throw new Error('提交失败')
      store.saveOrders([order].concat(store.getOrders().filter(item => item.id !== order.id)))
      this.pendingPayOrderId = order.id
      const payable = Math.max(0, Number(order.originalPrice) - Number(order.discountAmount))
      this.setData({ orderPayableText: money(payable) })
      if (this.data.reviewMode || order.status !== 'unpaid' || payable <= 0) {
        this.openOrderDetail(order.id, '提交成功')
        return
      }
      return this.requestPaymentSign(order.id)
    }).catch(error => {
      this.setData({ submitting: false })
      if (error && error.code === 'COUPON_UNAVAILABLE') {
        this.couponMode = 'auto'
        this.manualCouponId = ''
        this.refreshCoupons(true)
      }
      const message = String(error && error.message || '提交失败')
      wx.showToast({ title: message.slice(0, 20), icon: 'none' })
    })
  },
  requestPaymentSign(orderId) {
    if (this.data.reviewMode) return Promise.resolve()
    wx.showLoading({ title: '获取支付信息…' })
    return orderApi.getPaymentSign(orderId).then(params => {
      const app = typeof getApp === 'function' ? getApp() : null
      return Promise.resolve(app && app.settingsRefreshTask).catch(() => {}).then(() => params)
    }).then(params => {
      wx.hideLoading()
      if (this.data.reviewMode) { this.setData({ submitting: false }); return }
      const qrImage = params && (params.qrImageUrl || params.qrImage)
      if (!qrImage) throw new Error('支付服务暂不可用')
      this.setData({ payQrImage: qrImage, showPayQr: true, submitting: false })
      this.startPaymentPolling()
    }).catch(() => {
      wx.hideLoading()
      this.setData({ submitting: false })
      if (this.data.reviewMode) return null
      wx.showModal({
        title: '订单已创建',
        content: '暂时未能加载支付二维码，请前往订单详情继续支付。',
        showCancel: false,
        success: () => this.openOrderDetail(orderId)
      })
      return null
    })
  },
  closePayQr() {
    this.paymentPollToken = (this.paymentPollToken || 0) + 1
    this.setData({ showPayQr: false, payQrImage: '' })
    if (this.pendingPayOrderId) this.openOrderDetail(this.pendingPayOrderId)
  },
  previewPayQr() {
    if (!this.data.reviewMode && this.data.payQrImage) wx.previewImage({ urls: [this.data.payQrImage] })
  },
  noop() {},
  startPaymentPolling() {
    const orderId = this.pendingPayOrderId
    if (!orderId || !this.data.showPayQr) return
    const token = (this.paymentPollToken || 0) + 1
    this.paymentPollToken = token
    let polls = 0
    const tick = () => {
      if (token !== this.paymentPollToken || !this.data.showPayQr || ++polls > 200) return
      orderApi.getOrder(orderId).then(result => {
        const order = result && result.order
        if (order && order.status && order.status !== 'unpaid') this.finishPayment(order)
        else if (token === this.paymentPollToken) this.$setTimeout(tick, 3000)
      }).catch(() => {
        if (token === this.paymentPollToken) this.$setTimeout(tick, 3000)
      })
    }
    this.$setTimeout(tick, 3000)
  },
  resumePaymentCheck() {
    if (!this.data.showPayQr || !this.pendingPayOrderId) return
    orderApi.getOrder(this.pendingPayOrderId).then(result => {
      const order = result && result.order
      if (order && order.status && order.status !== 'unpaid') this.finishPayment(order)
      else this.startPaymentPolling()
    }).catch(() => this.startPaymentPolling())
  },
  finishPayment(order) {
    this.paymentPollToken = (this.paymentPollToken || 0) + 1
    this.setData({ showPayQr: false, payQrImage: '' })
    this.openOrderDetail(order.id, order.status === 'cancelled' ? '订单已取消' : '支付成功')
  },
  openOrderDetail(orderId, toastTitle) {
    if (toastTitle) wx.showToast({ title: toastTitle, icon: toastTitle === '支付成功' || toastTitle === '提交成功' ? 'success' : 'none' })
    this.$setTimeout(() => {
      wx.redirectTo({ url: `${ROUTES.orderDetail}?id=${encodeURIComponent(orderId)}&role=user` })
    }, toastTitle ? 120 : 0)
  }
})
