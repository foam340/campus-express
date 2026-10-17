const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const { normalizeText } = require('../../../utils/format')
const { CAMPUS_SERVICE } = require('../../../config/constants')

createPage({
  data: { orderId: '', scene: '', adminWechat: '', qr: '/packages/account/assets/admin-wechat.jpg', additionalContacts: [], sceneTitle: '请添加客服微信', hint: '添加后请发送订单编号和问题说明。' },
  onLoad(query) {
    const config = {
      cancel: ['申请取消订单', '请向客服说明取消原因，客服确认骑手进度后处理退款。'],
      claim: ['申请理赔', '请发送订单编号、问题说明、商品价值证明和相关照片。单个订单最高理赔200元。']
    }
    const scene = Object.prototype.hasOwnProperty.call(config, query.scene) ? query.scene : ''
    const texts = config[scene] || ['请添加客服微信', '添加后请发送订单编号和问题说明。']
    const campus = (store.getUser() || {}).campus || 'nanhai'
    const service = CAMPUS_SERVICE[campus] || CAMPUS_SERVICE.nanhai
    // 仅正常模式展示新增客服，审核模式沿用原有单客服卡片。
    const additionalContacts = store.getSettings(campus).reviewMode === false ? (service.additionalContacts || []) : []
    this.setData({ orderId: normalizeText(query.orderId, 32), scene, adminWechat: service.wechat, qr: service.qr, additionalContacts, sceneTitle: texts[0], hint: texts[1] })
  },
  copyWechat() { wx.setClipboardData({ data: this.data.adminWechat, success: () => wx.showToast({ title: '微信号已复制' }) }) },
  onReviewModeChanged(reviewMode) {
    const campus = (store.getUser() || {}).campus || 'nanhai'
    const service = CAMPUS_SERVICE[campus] || CAMPUS_SERVICE.nanhai
    this.setData({ additionalContacts: reviewMode ? [] : (service.additionalContacts || []) })
  },
  copyOrder() { if (!this.data.orderId) return; wx.setClipboardData({ data: this.data.orderId, success: () => wx.showToast({ title: '订单号已复制' }) }) },
  previewQr() {
    wx.previewImage({ urls: [this.data.qr] })
  },
  copyAdditionalWechat(event) {
    const contact = this.data.additionalContacts[event.currentTarget.dataset.index]
    if (!contact) return
    wx.setClipboardData({ data: contact.wechat, success: () => wx.showToast({ title: '微信号已复制' }) })
  },
  previewAdditionalQr(event) {
    const contact = this.data.additionalContacts[event.currentTarget.dataset.index]
    if (!contact) return
    wx.previewImage({ urls: [contact.qr] })
  }
})
