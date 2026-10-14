const crypto = require('crypto')
const https = require('https')

const XORPAY_AID = String(process.env.XORPAY_AID || '').trim()
const XORPAY_SECRET = String(process.env.XORPAY_SECRET || '').trim()

function requireCredentials() {
  if (!XORPAY_AID || !XORPAY_SECRET) {
    const error = new Error('XorPay 支付配置缺失')
    error.code = 'XORPAY_NOT_CONFIGURED'
    throw error
  }
}

function md5(value) {
  return crypto.createHash('md5').update(String(value), 'utf8').digest('hex')
}

function postForm(pathname, params, operation) {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(params).toString()
    const request = https.request({
      hostname: 'xorpay.com',
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    }, response => {
      let data = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { data += chunk })
      response.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (parseError) {
          const error = new Error(`XorPay ${operation}响应解析失败`)
          error.code = 'XORPAY_INVALID_RESPONSE'
          error.ambiguous = operation === '退款'
          reject(error)
        }
      })
    })
    request.on('timeout', () => {
      const error = new Error(`XorPay ${operation}请求超时`)
      error.code = 'XORPAY_TIMEOUT'
      error.ambiguous = operation === '退款'
      request.destroy(error)
    })
    request.on('error', source => {
      if (source && source.code && /^XORPAY_/.test(source.code)) return reject(source)
      const error = new Error(`XorPay ${operation}请求失败：${source && source.message ? source.message : String(source)}`)
      error.code = source && source.code ? source.code : 'XORPAY_REQUEST_FAILED'
      error.ambiguous = operation === '退款'
      reject(error)
    })
    request.write(payload)
    request.end()
  })
}

function nativePaymentSign(name, price, orderId, notifyUrl) {
  return md5(`${name}native${price}${orderId}${notifyUrl}${XORPAY_SECRET}`)
}

async function createNativePayment({ name, price, orderId, notifyUrl, orderUid, expireSeconds = 600 }) {
  requireCredentials()
  const params = {
    name,
    pay_type: 'native',
    price,
    order_id: orderId,
    notify_url: notifyUrl,
    expire: String(expireSeconds),
    sign: nativePaymentSign(name, price, orderId, notifyUrl)
  }
  if (orderUid) params.order_uid = String(orderUid)
  return postForm(`/api/pay/${encodeURIComponent(XORPAY_AID)}`, params, '支付')
}

function verifyPaymentCallback({ aoid, order_id, pay_price, pay_time, sign }) {
  if (!XORPAY_SECRET || !sign) return false
  const expected = md5(`${String(aoid || '')}${String(order_id || '')}${String(pay_price || '')}${String(pay_time || '')}${XORPAY_SECRET}`)
  const actualBuffer = Buffer.from(String(sign).toLowerCase(), 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

async function refundOrder(aoid, price) {
  requireCredentials()
  const refundPrice = String(price)
  return postForm(`/api/refund/${encodeURIComponent(aoid)}`, {
    price: refundPrice,
    sign: md5(`${refundPrice}${XORPAY_SECRET}`)
  }, '退款')
}

module.exports = { createNativePayment, refundOrder, verifyPaymentCallback }
