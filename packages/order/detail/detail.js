const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const orderApi = require('../../../utils/order-api')
const { clearPrivateFileCache, downloadPrivateFiles } = require('../../../utils/private-file')
const { ROUTES } = require('../../../config/constants')

const STEP_MAP = { waiting: 0, accepted: 1, picked: 2, delivering: 3, delivered: 4, completed: 5, cancelled: 0, disputed: 4 }

function mergeCachedOrder(order) {
  if (!order || !order.id) return
  const items = store.getOrders().filter(item => item.id !== order.id)
  store.saveOrders([order].concat(items))
}

function getPrivacyState(order, role) {
  const source = order && typeof order === 'object' ? order : {}
  const settings = store.getSettings()
  const completedAtMs = Number(source.completedAtMs) || 0
  const configuredHours = Math.max(1, Number(source.observationHours) || Number(settings.observationHours) || 24)
  const observationEndsAt = Number(source.observationEndsAt) || (completedAtMs ? completedAtMs + configuredHours * 60 * 60 * 1000 : 0)
  return {
    configuredHours,
    observationEndsAt,
    sensitiveVisible: !(role === 'rider' && observationEndsAt && Date.now() >= observationEndsAt)
  }
}

function withoutPrivateImages(order) {
  return Object.assign({}, order || {}, { screenshots: [], deliveryImages: [] })
}

createPage({
  data: { order: null, role: 'user', step: 0, deliveryImages: [], pendingDeliveryImages: [], contactInitial: '', canRequestCancel: false, showExceptionHint: false, canTransfer: false, sensitiveVisible: true, observationText: '', showPayQr: false, payQrImage: '', reviewMode: true, submitting: false, imageLoading: false, pendingScreenshotCount: 0, pendingDeliveryCount: 0 },
  onLoad(query) {
    this.id = String(query.id || '')
    this.role = query.role === 'rider' ? 'rider' : 'user'
    this.explicitRole = query.role === 'rider'
    this.loadSequence = 0
    // 审核模式改用本地缓存判断（app.js 启动时已从服务端同步），避免每次进详情页实时拉设置拖慢响应
    this.setData({ reviewMode: store.getSettings().reviewMode !== false })
  },
  onShow() { if (this.id) { this.refresh(); this.resumePaymentCheck() } },
  refresh() {
    const cached = store.getOrder(this.id)
    const role = this.explicitRole ? 'rider' : 'user'
    if (cached) this.renderOrder(withoutPrivateImages(cached), role)
    const sequence = ++this.loadSequence
    orderApi.getOrder(this.id).then(result => {
      if (!result || !result.order || sequence !== this.loadSequence) return
      mergeCachedOrder(result.order)
      // 订单文字和状态立即渲染，私密图片在后台按需下载，避免慢图片阻塞整页。
      this.renderOrder(withoutPrivateImages(result.order), role)
      if (!getPrivacyState(result.order, role).sensitiveVisible) return
      this.beginImageLoad(result.order)
      return this.hydrateImages(result.order, role, sequence)
    }).catch(error => {
      this.endImageLoad()
      if (!cached) wx.showToast({ title: String(error && error.message || 'ORDER_LOAD_FAILED').slice(0, 20), icon: 'none' })
    })
  },
  hydrateImages(order, role, sequence) {
    const source = order && typeof order === 'object' ? order : {}
    // 渐进渲染：取件截图、送达截图各自下完就各自显示，不再等另一组慢图一起卡住。
    const current = withoutPrivateImages(source)
    // 显示用缩略图（服务端 ?size=thumb），原图几 MB 下载太慢；点开大图看的也是这张缩略图。
    const thumbUrls = urls => (Array.isArray(urls) ? urls : []).filter(Boolean).map(u => `${u}${u.indexOf('?') >= 0 ? '&' : '?'}size=thumb`)
    const apply = (field, values, pendingField) => {
      if (sequence !== this.loadSequence) return
      current[field] = values
      this.renderOrder(current, role)
      this.setData({ [pendingField]: 0 })
    }
    return Promise.all([
      downloadPrivateFiles(thumbUrls(source.screenshots)).then(values => apply('screenshots', values, 'pendingScreenshotCount')),
      downloadPrivateFiles(thumbUrls(source.deliveryImages)).then(values => apply('deliveryImages', values, 'pendingDeliveryCount'))
    ]).then(() => {
      if (sequence === this.loadSequence) this.endImageLoad()
    })
  },
  // 私密图片开始后台下载前，用原始订单里的截图数量标记加载态，让截图区先占位显示「图片加载中…」，
  // 而不是空着等图突然蹦出来。
  beginImageLoad(order) {
    const source = order && typeof order === 'object' ? order : {}
    this.setData({
      imageLoading: true,
      pendingScreenshotCount: Array.isArray(source.screenshots) ? source.screenshots.filter(Boolean).length : 0,
      pendingDeliveryCount: Array.isArray(source.deliveryImages) ? source.deliveryImages.filter(Boolean).length : 0
    })
  },
  endImageLoad() {
    this.setData({ imageLoading: false, pendingScreenshotCount: 0, pendingDeliveryCount: 0 })
  },
  renderOrder(order, role) {
    const { configuredHours, observationEndsAt, sensitiveVisible } = getPrivacyState(order, role)
    const visibleOrder = sensitiveVisible ? order : Object.assign({}, order, {
      room: '', address: '', phone: '', contactName: '', note: '', screenshots: [], deliveryImages: []
    })
    if (!sensitiveVisible) clearPrivateFileCache()
    this.setData({
      order: visibleOrder, role,
      step: STEP_MAP[visibleOrder.status] || 0,
      deliveryImages: sensitiveVisible && Array.isArray(visibleOrder.deliveryImages) && visibleOrder.deliveryImages.length ? visibleOrder.deliveryImages : [],
      contactInitial: String(visibleOrder.contactName || '').charAt(0),
      canRequestCancel: visibleOrder.accepted && !['delivered', 'completed', 'cancelled', 'disputed'].includes(visibleOrder.status),
      // 骑手侧「订单遇到问题？请联系客服」提示（纯文案，无交互）
      showExceptionHint: ['accepted', 'picked', 'delivering'].includes(visibleOrder.status),
      // 转单只在「已接单、未取件」开放（后端同样只认这个状态）
      canTransfer: role === 'rider' && visibleOrder.status === 'accepted',
      sensitiveVisible,
      observationText: visibleOrder.financialStatus === 'observation' ? `${configuredHours}小时观察期` : visibleOrder.financialStatus === 'available' ? '可提现' : ''
    })
    this.schedulePrivacyHide(role, observationEndsAt)
  },
  schedulePrivacyHide(role, endsAt) {
    if (this.privacyTimer) {
      clearTimeout(this.privacyTimer)
      if (this.__managedTimers) this.__managedTimers.delete(this.privacyTimer)
      this.privacyTimer = null
    }
    const delay = Number(endsAt) - Date.now()
    if (role !== 'rider' || !Number.isFinite(delay) || delay <= 0) return
    this.privacyTimer = this.$setTimeout(() => {
      this.privacyTimer = null
      clearPrivateFileCache()
      const current = this.data.order || {}
      this.setData({
        sensitiveVisible: false,
        deliveryImages: [],
        order: Object.assign({}, current, { room: '', address: '', phone: '', contactName: '', note: '', screenshots: [], deliveryImages: [] })
      })
    }, delay)
  },
  callUser() {
    const phone = this.data.role === 'rider' ? this.data.order.phone : this.data.order.riderPhone
    if (!phone) { wx.showToast({ title: '暂无电话', icon: 'none' }); return }
    wx.makePhoneCall({ phoneNumber: String(phone) })
  },
  copyPhone() {
    const phone = this.data.role === 'rider' ? this.data.order.phone : this.data.order.riderPhone
    if (!phone) { wx.showToast({ title: '暂无电话', icon: 'none' }); return }
    wx.setClipboardData({
      data: String(phone),
      success: () => wx.showModal({ title: '发短信', content: '用户手机号已复制，请打开手机短信应用，粘贴并发送。', showCancel: false, confirmText: '知道了' })
    })
  },
  previewScreenshot(event) {
    const src = event.currentTarget.dataset.src
    const urls = this.data.order && Array.isArray(this.data.order.screenshots) ? this.data.order.screenshots : []
    if (src && urls.length) wx.previewImage({ current: src, urls })
  },
  previewDeliveryImage(event) {
    const src = event.currentTarget.dataset.src
    const urls = this.data.order && Array.isArray(this.data.order.deliveryImages) ? this.data.order.deliveryImages : []
    if (src && urls.length) wx.previewImage({ current: src, urls })
  },
  replaceOrder(order) {
    mergeCachedOrder(order)
    const role = this.data.role
    const sequence = ++this.loadSequence
    this.renderOrder(withoutPrivateImages(order), role)
    if (getPrivacyState(order, role).sensitiveVisible) {
      this.beginImageLoad(order)
      this.hydrateImages(order, role, sequence)
    }
    return Promise.resolve(order)
  },
  cancelWaiting() {
    wx.showModal({ title: this.data.reviewMode ? '取消登记' : '取消订单', content: this.data.reviewMode ? '确定要取消该登记吗？' : '确定要取消该订单吗？取消后优惠券将退回', confirmColor: '#e8505b', success: result => {
      if (!result.confirm) return
      orderApi.cancelOrder(this.id).then(result => {
        if (!result || !result.order) throw new Error('CANCEL_FAILED')
        return this.replaceOrder(result.order).then(() => result.refund)
      }).then(refund => this.showCancelResult(refund))
        .catch(error => wx.showToast({ title: String(error && error.message || 'CANCEL_FAILED').slice(0, 20), icon: 'none' }))
    }})
  },
  showCancelResult(refund) {
    if (!refund) { wx.showToast({ title: '已取消', icon: 'success' }); return }
    const messages = {
      succeeded: '订单已取消，退款已原路退回。',
      pending: '订单已取消，退款正在处理中。',
      processing: '订单已取消，退款正在处理中。',
      retryable: '订单已取消，退款服务稍后会自动重试。',
      manual_review: '订单已取消，退款结果需要人工核对，请联系客服并提供订单号。'
    }
    wx.showModal({ title: '取消结果', content: messages[refund.status] || '订单已取消，退款状态请稍后查看。', showCancel: false })
  },
  requestCancel() { wx.navigateTo({ url: `${ROUTES.service}?orderId=${encodeURIComponent(this.id)}&scene=cancel` }) },
  transferOrder() {
    const order = this.data.order || {}
    const income = Number(order.price) || 0
    const choices = ['临时有事，无法配送', '时间来不及', '距离太远', '身体不适', '其他原因']
    wx.showActionSheet({ itemList: choices, success: result => {
      const reason = choices[result.tapIndex]
      wx.showModal({
        title: '转单给其他骑手',
        content: this.data.reviewMode ? '本单将放回接单大厅，其他骑手可重新接单。转单后不能立刻接回本单。' : `本单将放回接单大厅，其他骑手可重新接单。转单后你将失去本单收入${income > 0 ? `（¥${income}）` : ''}，且不能立刻接回本单。`,
        confirmText: '确认转单',
        confirmColor: '#e8505b',
        success: modal => {
          if (!modal.confirm) return
          orderApi.transferOrder(this.id, reason).then(next => {
            if (!next) throw new Error('TRANSFER_FAILED')
            return this.replaceOrder(next)
          }).then(() => wx.showModal({ title: '已转单', content: '订单已放回接单大厅，等待其他骑手接单', showCancel: false }))
            .catch(error => wx.showToast({ title: String(error && error.message || 'TRANSFER_FAILED').slice(0, 20), icon: 'none' }))
        }
      })
    }})
  },
  advance() {
    // 防重入：骑手在网络慢时会连点，没有这个闸门每点一次就发一次请求。
    if (this.data.submitting) return
    const status = (this.data.order || {}).status
    const action = status === 'accepted' ? 'picked' : status === 'picked' ? 'delivering' : ''
    if (!action) return
    this.setData({ submitting: true })
    orderApi.updateRiderStatus(this.id, action).then(order => this.replaceOrder(order)).then(() => wx.showToast({ title: '操作成功', icon: 'success' }))
      .catch(error => {
        // 失败后必须重拉一次：请求可能其实已在服务端生效、只是响应丢了，此时服务端状态已推进，
        // 而按钮还停在旧状态，再点只会一直吃 409「订单状态已变化」。重拉把按钮纠回正确状态。
        this.refresh()
        wx.showToast({ title: String(error && error.message || 'UPDATE_FAILED').slice(0, 20), icon: 'none' })
      })
      .finally(() => this.setData({ submitting: false }))
  },
  chooseDeliveryImage() {
    const total = this.data.deliveryImages.length + this.data.pendingDeliveryImages.length
    const remaining = Math.max(0, 3 - total)
    if (!remaining) return
    wx.chooseMedia({ count: remaining, mediaType: ['image'], sourceType: ['camera', 'album'], success: result => {
      const paths = (result.tempFiles || []).map(item => item && item.tempFilePath).filter(Boolean)
      if (!paths.length) return
      const maxPending = Math.max(0, 3 - this.data.deliveryImages.length)
      this.setData({ pendingDeliveryImages: this.data.pendingDeliveryImages.concat(paths).slice(0, maxPending) })
    }})
  },
  confirmDelivered() {
    if (this.data.submitting) return
    if (!this.data.pendingDeliveryImages.length) {
      wx.showToast({ title: '请先拍照上传送达凭证', icon: 'none' })
      return
    }
    this.setData({ submitting: true })
    // 送达是「先 wx.uploadFile 传图、再发状态请求」，而 upload.js 不走 request 的加载遮罩，
    // 整个上传期间屏幕上原本没有任何反馈，骑手以为没点上就反复点，每点一次整批图片重传一遍。
    // 这里自己盖一层遮罩，把上传那段空窗一并盖住（request 自己的遮罩会无缝接上，不会中途消失）。
    wx.showLoading({ title: '正在提交…', mask: true })
    orderApi.updateRiderStatus(this.id, 'delivered', this.data.pendingDeliveryImages).then(order => {
      // 遮罩必须先关：wx.showModal 在遮罩未关闭时不会显示出来。
      wx.hideLoading()
      this.setData({ pendingDeliveryImages: [] })
      return this.replaceOrder(order)
    }).then(() => {
      wx.showModal({ title: '提示', content: '送达后12小时用户未确认将自动完成', showCancel: false })
    }).catch(error => {
      wx.hideLoading()
      // 同 advance：失败可能是「服务端已生效、响应丢了」，重拉一次纠正按钮状态，
      // 否则按钮会永远停在「确认已送达」而每次都 409。
      this.refresh()
      wx.showToast({ title: String(error && error.message || 'DELIVERY_FAILED').slice(0, 20), icon: 'none' })
    }).finally(() => this.setData({ submitting: false }))
  },
  confirmReceipt() {
    const hours = Math.max(1, Number(this.data.order && this.data.order.observationHours) || Number(store.getSettings().observationHours) || 24)
    wx.showModal({ title: '确认收货', content: `确认收货后将进入${hours}小时售后观察期`, confirmText: '确认', success: result => {
      if (!result.confirm) return
      orderApi.confirmReceipt(this.id).then(order => this.replaceOrder(order)).then(() => wx.showToast({ title: '已确认', icon: 'success' }))
        .catch(error => wx.showToast({ title: String(error && error.message || 'CONFIRM_FAILED').slice(0, 20), icon: 'none' }))
    }})
  },
  notReceived() {
    wx.showModal({ title: '未收到快递', content: '确认后将生成售后工单，请稍后联系客服处理', confirmColor: '#e8505b', success: result => {
      if (!result.confirm) return
      orderApi.reportMissing(this.id).then(order => this.replaceOrder(order)).then(() => wx.navigateTo({ url: `${ROUTES.service}?orderId=${encodeURIComponent(this.id)}&scene=claim` }))
        .catch(error => wx.showToast({ title: String(error && error.message || 'REPORT_FAILED').slice(0, 20), icon: 'none' }))
    }})
  },
  service() { wx.navigateTo({ url: `${ROUTES.service}?orderId=${encodeURIComponent(this.id)}` }) },
  retryPayment() {
    if (this.data.reviewMode) return
    const order = this.data.order
    if (!order) return
    if (order.status !== 'unpaid') {
      wx.showToast({ title: '无需支付', icon: 'none' })
      return
    }
    wx.showLoading({ title: '获取支付信息…' })
    return orderApi.getPaymentSign(order.id).then(params => {
      const app = typeof getApp === 'function' ? getApp() : null
      return Promise.resolve(app && app.settingsRefreshTask).catch(() => {}).then(() => params)
    }).then(params => {
      wx.hideLoading()
      if (this.data.reviewMode) return
      const qrImage = params && (params.qrImageUrl || params.qrImage)
      if (!qrImage) {
        wx.showToast({ title: '支付服务暂不可用', icon: 'none' })
        return
      }
      this.setData({ payQrImage: qrImage, showPayQr: true })
      this.startPaymentPolling()
    }).catch(() => {
      wx.hideLoading()
      wx.showToast({ title: '获取支付参数失败', icon: 'none' })
    })
  },
  closePayQr() {
    if (!this.data.showPayQr) return
    this.setData({ showPayQr: false, payQrImage: '' })
    this.refresh()
  },
  previewPayQr() {
    if (!this.data.reviewMode) wx.previewImage({ urls: [this.data.payQrImage] })
  },
  startPaymentPolling() {
    let polls = 0
    const tick = () => {
      if (!this.data.showPayQr) return
      if (++polls > 200) return
      orderApi.getOrder(this.id).then(result => {
        const order = result && result.order
        if (order && order.status === 'cancelled') this.finishPaymentCancelled()
        else if (order && order.status && order.status !== 'unpaid') this.finishPaymentSuccess()
        else if (this.data.showPayQr) this.$setTimeout(tick, 3000)
      }).catch(() => { if (this.data.showPayQr) this.$setTimeout(tick, 3000) })
    }
    this.$setTimeout(tick, 3000)
  },
  finishPaymentSuccess() {
    this.setData({ showPayQr: false, payQrImage: '' })
    wx.showToast({ title: '支付成功', icon: 'success' })
    this.refresh()
  },
  finishPaymentCancelled() {
    this.setData({ showPayQr: false, payQrImage: '' })
    wx.showToast({ title: '订单已取消', icon: 'none' })
    this.refresh()
  },
  resumePaymentCheck() {
    if (!this.data.showPayQr) return
    orderApi.getOrder(this.id).then(result => {
      const order = result && result.order
      if (order && order.status === 'cancelled') this.finishPaymentCancelled()
      else if (order && order.status && order.status !== 'unpaid') this.finishPaymentSuccess()
      else this.startPaymentPolling()
    }).catch(() => this.startPaymentPolling())
  },
})
