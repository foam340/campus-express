const createPage = require('../../../utils/page')
const store = require('../../../utils/store')
const orderApi = require('../../../utils/order-api')
const { formatDateTime } = require('../../../utils/format')

createPage({
  data: { balance: { available: 0, pending: 0, withdrawLeft: 5 }, records: [], reviewMode: true },
  onShow() {
    const reviewMode = store.getSettings().reviewMode !== false
    this.setData({ reviewMode })
    if (!reviewMode) this.refresh()
  },
  refresh() {
    orderApi.getRiderWallet().then(result => {
      const records = (result.records || []).map(item => Object.assign({}, item, {
        date: formatDateTime(item.dateMs), amountText: `${Number(item.amount || 0) >= 0 ? '+' : ''}¥${Number(item.amount || 0).toFixed(2)}`
      }))
      this.setData({ balance: Object.assign({ available: 0, pending: 0, withdrawLeft: 5 }, result.balance || {}), records })
    }).catch(error => wx.showToast({ title: String(error && error.message || 'WALLET_LOAD_FAILED').slice(0, 20), icon: 'none' }))
  },
  withdraw() {
    const balance = this.data.balance || {}
    const amount = Number(balance.available) || 0
    if (amount <= 0) { wx.showToast({ title: '\u6682\u65e0\u53ef\u63d0\u73b0\u4f59\u989d', icon: 'none' }); return }
    if (!(Number(balance.withdrawLeft) > 0)) { wx.showToast({ title: '\u672c\u6708\u63d0\u73b0\u6b21\u6570\u5df2\u7528\u5b8c', icon: 'none' }); return }
    wx.showModal({
      title: '\u7533\u8bf7\u63d0\u73b0',
      content: `\u672c\u6b21\u5c06\u7533\u8bf7\u63d0\u73b0 \u00a5${amount.toFixed(2)}\uff0c\u672c\u6708\u8fd8\u5269 ${Number(balance.withdrawLeft) - 1} \u6b21\u3002`,
      confirmText: '\u786e\u8ba4\u63d0\u73b0',
      success: result => {
        if (!result.confirm) return
        orderApi.requestWithdrawal(amount).then(() => { wx.showToast({ title: '\u63d0\u73b0\u7533\u8bf7\u5df2\u63d0\u4ea4', icon: 'success' }); this.refresh() })
          .catch(error => wx.showToast({ title: String(error && error.message || 'WITHDRAW_FAILED').slice(0, 20), icon: 'none' }))
      }
    })
  }
})
