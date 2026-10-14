const createPage = require('../../../utils/page')
const { submitFeedback } = require('../../../utils/order-api')

const CATEGORIES = ['suggestion', 'problem', 'other']
const CATEGORY_LABELS = ['功能建议', '使用问题', '其他']

createPage({
  data: { categories: CATEGORY_LABELS, categoryIndex: 0, content: '', submitting: false },
  onCategoryChange(event) {
    this.setData({ categoryIndex: Number(event.detail.value) || 0 })
  },
  onContentInput(event) {
    this.setData({ content: event.detail.value || '' })
  },
  submit() {
    const content = String(this.data.content || '').trim()
    if (content.length < 2) { wx.showToast({ title: '请至少输入2个字', icon: 'none' }); return }
    if (this.data.submitting) return
    this.setData({ submitting: true })
    submitFeedback({ category: CATEGORIES[this.data.categoryIndex], content })
      .then(() => {
        wx.showToast({ title: '提交成功，感谢你的反馈', icon: 'success' })
        this.$setTimeout(() => wx.navigateBack(), 1200)
      })
      .catch(error => {
        wx.showToast({ title: (error && error.message) || '提交失败，请稍后重试', icon: 'none' })
      })
      .finally(() => this.setData({ submitting: false }))
  }
})
