const SIZE_LABEL = { small: '小件', medium: '中件', large: '大件' }
const SIZE_ORDER = ['small', 'medium', 'large']

// 把订单每件快递的尺寸聚合成「小件×2 · 中件×1 · 大件×1」；无尺寸明细（老单）回退成「N件快递」
function summarizeSize(order) {
  const items = (order && order.items) || []
  if (!items.length) return (order && order.pieces) ? `${order.pieces}件快递` : ''
  const counts = { small: 0, medium: 0, large: 0 }
  let valid = 0
  items.forEach(item => {
    if (item && SIZE_LABEL[item.size]) { counts[item.size]++; valid++ }
  })
  if (!valid) return (order && order.pieces) ? `${order.pieces}件快递` : ''
  const parts = []
  SIZE_ORDER.forEach(size => { if (counts[size]) parts.push(`${SIZE_LABEL[size]}×${counts[size]}`) })
  return parts.join(' · ')
}

Component({
  properties: {
    order: { type: Object, value: {} },
    variant: { type: String, value: 'user' },
    taskCount: { type: Number, value: 0 },
    maxTaskCount: { type: Number, value: 3 },
    reviewMode: { type: Boolean, value: true }
  },
  data: {
    sizeSummary: ''
  },
  observers: {
    order(order) { this.setData({ sizeSummary: summarizeSize(order) }) }
  },
  methods: {
    handleOpen() { this.triggerEvent('open', { id: this.data.order.id }) },
    handleGrab() { this.triggerEvent('grab', { id: this.data.order.id }) }
  }
})
