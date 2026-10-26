const nodemailer = require('nodemailer')

let transporter = null

function urgentEmailConfig() {
  return require('./config').urgentEmail
}

function emailTransporter() {
  if (transporter) return transporter
  const config = urgentEmailConfig()
  transporter = nodemailer.createTransport({
    pool: false,
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: {
      user: config.user,
      pass: config.pass
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    disableFileAccess: true,
    disableUrlAccess: true,
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    }
  })
  return transporter
}

async function verifyUrgentEmailTransport() {
  if (!urgentEmailConfig().enabled) throw new Error('URGENT_EMAIL_DISABLED')
  return emailTransporter().verify()
}

function classifySmtpFailure(error) {
  const responseCode = Number(error && error.responseCode)
  if (!Number.isInteger(responseCode) || responseCode < 400 || responseCode > 599) return null
  return {
    ok: false,
    code: `SMTP_${responseCode}`,
    messageId: '',
    response: ''
  }
}

async function sendUrgentOrderEmail(orderId, message) {
  const config = urgentEmailConfig()
  if (!config.enabled) throw new Error('URGENT_EMAIL_DISABLED')
  const orderSuffix = String(orderId || '').slice(-8)
  let info
  try {
    info = await emailTransporter().sendMail({
      from: config.from,
      to: config.to,
      subject: String(message && message.subject || '').slice(0, 160),
      text: String(message && message.text || '').slice(0, 4000),
      headers: {
        'X-Campus-Notification': 'urgent-unaccepted-30m',
        'X-Campus-Order': orderSuffix
      }
    })
  } catch (error) {
    const rejected = classifySmtpFailure(error)
    if (rejected) return rejected
    throw error
  }
  const accepted = Array.isArray(info && info.accepted) ? info.accepted : []
  const responseCode = String(info && info.response || '').match(/^\d{3}/)
  return {
    ok: accepted.length > 0,
    code: accepted.length > 0 ? 'ACCEPTED' : 'RECIPIENT_REJECTED',
    messageId: String(info && info.messageId || '').slice(0, 128),
    response: responseCode ? responseCode[0] : ''
  }
}

// 骑手新单邮件：一封 BCC 广播给本校区所有填了邮箱的骑手，发件人同时抄送自己保证 To 头合法。
async function sendRiderNotificationEmail(recipients, message) {
  const config = urgentEmailConfig()
  if (!config.enabled) throw new Error('URGENT_EMAIL_DISABLED')
  const safeRecipients = (Array.isArray(recipients) ? recipients : [])
    .map(item => String(item || '').trim())
    .filter(item => item && item.length <= 254)
  if (!safeRecipients.length) {
    return { ok: false, code: 'NO_RECIPIENTS', messageId: '', response: '' }
  }
  let info
  try {
    info = await emailTransporter().sendMail({
      from: config.from,
      to: config.from,
      bcc: safeRecipients,
      subject: String(message && message.subject || '').slice(0, 160),
      text: String(message && message.text || '').slice(0, 4000),
      headers: {
        'X-Campus-Notification': 'new-order-rider-email'
      }
    })
  } catch (error) {
    const rejected = classifySmtpFailure(error)
    if (rejected) return rejected
    throw error
  }
  const accepted = Array.isArray(info && info.accepted) ? info.accepted : []
  const responseCode = String(info && info.response || '').match(/^\d{3}/)
  return {
    ok: accepted.length > 0,
    code: accepted.length > 0 ? 'ACCEPTED' : 'RECIPIENT_REJECTED',
    messageId: String(info && info.messageId || '').slice(0, 128),
    response: responseCode ? responseCode[0] : ''
  }
}

// 骑手提现结清回执：点对点发给单个骑手（提现为线下私下打款、平台仅记账）。
async function sendRiderWithdrawalEmail(to, message) {
  const config = urgentEmailConfig()
  if (!config.enabled) throw new Error('URGENT_EMAIL_DISABLED')
  const safeTo = String(to || '').trim()
  if (!safeTo || safeTo.length > 254) {
    return { ok: false, code: 'NO_RECIPIENTS', messageId: '', response: '' }
  }
  let info
  try {
    info = await emailTransporter().sendMail({
      from: config.from,
      to: safeTo,
      subject: String(message && message.subject || '').slice(0, 160),
      text: String(message && message.text || '').slice(0, 4000),
      headers: {
        'X-Campus-Notification': 'rider-withdrawal-email'
      }
    })
  } catch (error) {
    const rejected = classifySmtpFailure(error)
    if (rejected) return rejected
    throw error
  }
  const accepted = Array.isArray(info && info.accepted) ? info.accepted : []
  const responseCode = String(info && info.response || '').match(/^\d{3}/)
  return {
    ok: accepted.length > 0,
    code: accepted.length > 0 ? 'ACCEPTED' : 'RECIPIENT_REJECTED',
    messageId: String(info && info.messageId || '').slice(0, 128),
    response: responseCode ? responseCode[0] : ''
  }
}

// 新提现申请提醒：与骑手结清回执使用不同收件人和邮件类型，不重试。
async function sendWithdrawalRequestEmail(message) {
  const config = urgentEmailConfig()
  if (!config.enabled) throw new Error('URGENT_EMAIL_DISABLED')
  const to = require('./config').withdrawalRequestEmailTo
  if (!to || to.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) {
    return { ok: false, code: 'INVALID_RECIPIENT', messageId: '', response: '' }
  }
  let info
  try {
    info = await emailTransporter().sendMail({
      from: config.from,
      to,
      subject: String(message && message.subject || '').slice(0, 160),
      text: String(message && message.text || '').slice(0, 4000),
      headers: { 'X-Campus-Notification': 'withdrawal-request-email' }
    })
  } catch (error) {
    const rejected = classifySmtpFailure(error)
    if (rejected) return rejected
    throw error
  }
  const accepted = Array.isArray(info && info.accepted) ? info.accepted : []
  const responseCode = String(info && info.response || '').match(/^\d{3}/)
  return {
    ok: accepted.length > 0,
    code: accepted.length > 0 ? 'ACCEPTED' : 'RECIPIENT_REJECTED',
    messageId: String(info && info.messageId || '').slice(0, 128),
    response: responseCode ? responseCode[0] : ''
  }
}

module.exports = { classifySmtpFailure, sendUrgentOrderEmail, sendRiderNotificationEmail, sendRiderWithdrawalEmail, sendWithdrawalRequestEmail, verifyUrgentEmailTransport }
