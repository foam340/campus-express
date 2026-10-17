const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const { ROUTES, CAMPUS_SERVICE } = require('../../../config/constants')
const { isPhone } = require('../../../utils/validators')
const orderApi = require('../../../utils/order-api')
const { RIDER_RULES_VERSION, RIDER_RULE_SECTIONS } = require('../../../config/rider-rules')
const modeStore = require('../../../utils/mode')

// 审核展示不呈现财务条款；正常模式继续使用完整的原版规则。
const REVIEW_RULE_SECTIONS = RIDER_RULE_SECTIONS.filter(section => !/费用|结算|收入/.test(section.title)).map(section => ({
  title: section.title,
  items: section.items.filter(rule => !/[¥￥]|\d+(?:\.\d+)?\s*元/.test(rule))
}))

createPage({
  data: {
    user: {}, agreed: false, wechatAdded: false, ruleRead: false, rulesVisible: false, rulesReachedBottom: false,
    rulesVersion: RIDER_RULES_VERSION, ruleSections: RIDER_RULE_SECTIONS, reviewRuleSections: REVIEW_RULE_SECTIONS, adminWechat: '', qr: '/packages/account/assets/admin-wechat.jpg',
    gender: '', genderLabels: ['男', '女']
  },
  onLoad() {
    const user = store.getUser() || {}
    this.studentId = ''
    this.realName = ''
    this.phone = String(user.phone || '')
    const campus = (user || {}).campus || 'nanhai'
    const service = CAMPUS_SERVICE[campus] || CAMPUS_SERVICE.nanhai
    this.setData({ user, adminWechat: service.wechat, qr: service.qr })
  },
  toggleAgreed() {
    if (!this.data.agreed && !this.data.ruleRead) { this.showRules(); return }
    this.setData({ agreed: !this.data.agreed })
  },
  toggleWechatAdded() { this.setData({ wechatAdded: !this.data.wechatAdded }) },
  showRules() { this.setData({ rulesVisible: true, rulesReachedBottom: this.data.ruleRead }) },
  closeRules() { this.setData({ rulesVisible: false }) },
  markRulesRead() { if (!this.data.rulesReachedBottom) this.setData({ rulesReachedBottom: true }) },
  acceptRules() {
    if (!this.data.rulesReachedBottom) { wx.showToast({ title:'请先阅读至规则底部', icon:'none' }); return }
    this.setData({ rulesVisible:false, ruleRead:true, agreed:true })
  },
  noop() {},
  inputStudentId(e) { this.studentId = String(e.detail.value || '').slice(0, 30) },
  inputRealName(e) { this.realName = String(e.detail.value || '').slice(0, 20) },
  inputPhone(e) { this.phone = String(e.detail.value || '').slice(0, 11) },
  onPickGender(e) { const index = Number(e.detail.value); this.setData({ gender: index === 0 ? 'male' : 'female' }) },
  copyWechat() { wx.setClipboardData({ data: this.data.adminWechat, success: () => wx.showToast({ title: '微信号已复制' }) }) },
  previewQr() {
    wx.previewImage({ urls: [this.data.qr] })
  },
  submit() {
    const realName = String(this.realName || '').trim()
    if (realName.length < 2 || realName.length > 20) { wx.showToast({ title: '请填写真实姓名（2-20字）', icon: 'none' }); return }
    if (!this.studentId) { wx.showToast({ title: '\u8bf7\u586b\u5199\u5b66\u53f7', icon: 'none' }); return }
    if (!this.data.gender) { wx.showToast({ title: '请选择性别', icon: 'none' }); return }
    const phone = String(this.phone || '').trim()
    if (!isPhone(phone)) { wx.showToast({ title: '请输入正确的11位手机号', icon: 'none' }); return }
    if (!this.data.wechatAdded) { wx.showToast({ title: '\u8bf7\u5148\u6dfb\u52a0\u7ba1\u7406\u5458\u5fae\u4fe1', icon: 'none' }); return }
    if (!this.data.agreed) { wx.showToast({ title: '\u8bf7\u5148\u540c\u610f\u9a91\u624b\u670d\u52a1\u89c4\u5219', icon: 'none' }); return }
    if (this.submitting) return
    this.submitting = true
    orderApi.applyRider({ studentId: this.studentId, rulesVersion: this.data.rulesVersion, realName, gender: this.data.gender, phone }).then(() => {
      const user = Object.assign({}, store.getUser() || {}, { riderApproved: false, riderStatus: 'pending' })
      store.setUser(user)
      this.setData({ user })
      wx.showModal({ title: '\u7533\u8bf7\u5df2\u63d0\u4ea4', content: '\u8bf7\u7b49\u5f85\u7ba1\u7406\u5458\u4eba\u5de5\u5ba1\u6838\uff0c\u5ba1\u6838\u7ed3\u679c\u4f1a\u5728\u9a91\u624b\u5165\u53e3\u663e\u793a\u3002', showCancel: false })
    }).catch(error => wx.showToast({ title: String(error && error.message || 'APPLY_FAILED').slice(0, 20), icon: 'none' })).finally(() => { this.submitting = false })
  },
  contactAdmin() { wx.navigateTo({ url: ROUTES.service }) },
  switchRider() { modeStore.setMode('rider'); wx.switchTab({ url:ROUTES.riderHall }) }
})
