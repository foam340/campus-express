const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const orderApi = require('../../../utils/order-api')
const { CAMPUSES, CAMPUS_LABELS, getCampusConfig } = require('../../../config/constants')

createPage({
  data: {
    currentCampus: 'nanhai',
    currentCampusLabel: '南海校区',
    targetCampus: 'shipai',
    campuses: CAMPUSES,
    campusLabels: CAMPUS_LABELS,
    reason: '',
    submitting: false
  },
  onLoad() {
    const user = store.getUser() || {}
    const currentCampus = CAMPUSES.includes(user.campus) ? user.campus : CAMPUSES[0]
    this.setData({
      currentCampus,
      currentCampusLabel: getCampusConfig(currentCampus).label,
      targetCampus: CAMPUSES.find(c => c !== currentCampus) || currentCampus
    })
  },
  chooseTarget(event) {
    const value = String(event.currentTarget.dataset.value || '')
    if (!CAMPUSES.includes(value)) return
    if (value === this.data.currentCampus) return
    this.setData({ targetCampus: value })
  },
  inputReason(event) { this.setData({ reason: String(event.detail.value || '') }) },
  noop() {},
  submit() {
    if (this.data.submitting) return
    const reason = String(this.data.reason || '').trim()
    if (reason.length < 2) { wx.showToast({ title: '请填写变更原因', icon: 'none' }); return }
    this.setData({ submitting: true })
    orderApi.submitCampusChange({ toCampus: this.data.targetCampus, reason }).then(() => {
      this.setData({ submitting: false })
      wx.showModal({
        title: '申请已提交',
        content: '管理员审核通过后校区才会变更。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
    }).catch(error => {
      this.setData({ submitting: false })
      wx.showToast({ title: String(error && error.message || '提交失败').slice(0, 20), icon: 'none' })
    })
  }
})
