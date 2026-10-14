const createPage = require('../../../utils/page')

createPage({
  data: { imageUrl: '/packages/order/assets/size-guide.jpg' },
  preview() {
    const url = this.data.imageUrl
    wx.previewImage({
      current: url,
      urls: [url],
      fail: () => wx.showToast({ title: '可直接查看页面中的完整示例', icon: 'none' })
    })
  }
})
