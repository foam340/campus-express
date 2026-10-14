function moneyToCents(value) {
  const text = String(value == null ? '' : value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

function centsToMoney(cents) {
  const value = Number(cents)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_MONEY_CENTS')
  return (value / 100).toFixed(2)
}

function orderPayableCents(order) {
  const original = moneyToCents(order && order.original_price)
  const discount = moneyToCents(order && order.coupon_discount)
  if (original == null || discount == null) return null
  return Math.max(0, original - discount)
}

module.exports = { centsToMoney, moneyToCents, orderPayableCents }
