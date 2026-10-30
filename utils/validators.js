const { getDormBuildings, getCampusConfig } = require('../config/constants')

function isPhone(value) {
  // 11 位且第二位 3-9：12x 等号段不存在，防假号入库（骑手96曾填 12535678981 入库）。
  // 与后端 server/src/validation.js 的 phone() 保持一致，改一处必须同步另一处。
  return /^1[3-9]\d{9}$/.test(String(value || '').trim())
}

function isRoom(value) {
  return /^[1-9]\d{2,3}$/.test(String(value || '').trim())
}

function isName(value) {
  const text = String(value || '').trim()
  return text.length >= 1 && text.length <= 12
}

function isAddress(value) {
  const text = String(value || '').trim()
  return text.length >= 2 && text.length <= 50
}

// 骑手收新单通知邮箱：留空合法（=不接收），非空须为合法邮箱。
function isEmail(value) {
  const text = String(value || '').trim()
  return text === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
}

// —— 邮箱疑似手滑检测（与后端 business-rules.js 的 emailSuspicion 保持一致）——
// 已知邮箱提供商的合法域名：只对「明显是 .com 的手滑变体」提示，避免误伤 .cn/.net 等合法域名。
const EMAIL_PROVIDER_DOMAINS = {
  qq: ['qq.com'], '163': ['163.com'], '126': ['126.com'], yeah: ['yeah.net'],
  sina: ['sina.com', 'sina.cn'], gmail: ['gmail.com'], foxmail: ['foxmail.com'],
  outlook: ['outlook.com'], hotmail: ['hotmail.com'], '139': ['139.com'],
  '189': ['189.cn'], wo: ['wo.cn']
}
const SUSPICIOUS_TLDS = ['co', 'cm', 'con', 'comm', 'comn', 'om', 'c0m', 'conm']

// 返回 { suggest, reason } 或 null
function emailSuspicion(email) {
  const text = String(email || '').trim()
  if (!text || !text.includes('@')) return null
  const at = text.lastIndexOf('@')
  const local = text.slice(0, at)
  const domain = text.slice(at + 1).toLowerCase()
  const dot = domain.lastIndexOf('.')
  if (dot <= 0 || dot === domain.length - 1) return null
  const host = domain.slice(0, dot)
  const tld = domain.slice(dot + 1)
  const allowed = EMAIL_PROVIDER_DOMAINS[host]
  if (!allowed) return null
  if (allowed.indexOf(host + '.' + tld) >= 0) return null
  // 域名被截断的手滑（如 qq.c → qq.com）：打的域名是合法域名的严格前缀
  const truncated = allowed.find(d => d.startsWith(host + '.' + tld))
  if (truncated) return { suggest: local + '@' + truncated, reason: host + '.' + tld + ' 疑似为 ' + truncated + ' 的拼写错误' }
  if (SUSPICIOUS_TLDS.indexOf(tld) < 0) return null
  return { suggest: local + '@' + allowed[0], reason: host + '.' + tld + ' 疑似为 ' + allowed[0] + ' 的拼写错误' }
}

function validateRegistration(data) {
  if (!data || typeof data !== 'object') return '请完整填写注册信息'
  if (data.campus === 'gqg' && data.building === '东一栋') data = { ...data, building: '东1栋' }
  if (!isName(data.name)) return '请输入1—12个字的称呼'
  if (!isPhone(data.phone)) return '请输入正确的11位手机号'
  const campusCfg = getCampusConfig(data.campus)
  if (campusCfg && campusCfg.roomRule === 'free') {
    if (!getDormBuildings(data.campus).includes(data.building || '')) return '请选择宿舍楼'
    return ''
  }
  if (!isRoom(data.room)) return '请输入正确的门牌号，例如421'
  if (!getDormBuildings(data.campus).includes(data.building || '')) return '请选择宿舍楼'
  return ''
}

module.exports = { isPhone, isRoom, isName, isAddress, isEmail, emailSuspicion, validateRegistration }
