const { CAMPUS_CONFIG, getCampusConfig } = require('./campus-config')

// 楼栋白名单单一来源：campus-config.js（按校区取），本文件只做派生 Set 与展示格式化。
const DORM_BUILDINGS = Object.freeze([...CAMPUS_CONFIG.nanhai.buildingKeys])

const DORM_BUILDING_SET = new Set(DORM_BUILDINGS)
// 石牌宿舍楼：32 栋（「中区」「东19栋南」都是独立一栋）。不标性别、房号自由。
const SHIPAI_DORM_BUILDINGS = Object.freeze([...CAMPUS_CONFIG.shipai.buildingKeys])
const SHIPAI_DORM_BUILDING_SET = new Set(SHIPAI_DORM_BUILDINGS)
const MAX_ORDER_PIECES = 20
const MAX_PICKUP_IMAGES = 9
const MAX_DELIVERY_IMAGES = 3
const MAX_ITEMIZED_ORDER_ITEMS = 8

function normalizeDormBuilding(value) {
  const building = String(value || '').trim().replace(/(?:号楼|号栋|栋)$/, '').toUpperCase()
  return DORM_BUILDING_SET.has(building) ? building : ''
}

function formatDormBuilding(value, campus) {
  const raw = String(value || '').trim()
  if (SHIPAI_DORM_BUILDING_SET.has(raw)) return raw
  const cfg = getCampusConfig(campus)
  const keys = (cfg && cfg.buildingKeys) || CAMPUS_CONFIG.nanhai.buildingKeys
  const building = raw.replace(/(?:号楼|号栋|栋)$/u, '').toUpperCase()
  if (!keys.includes(building)) return ''
  // 南海（或未指定校区时按南海默认）的 25 显示为「25号楼」；广轻工等纯数字校区显示「25栋」
  return (!cfg || cfg.id === 'nanhai') && building === '25' ? '25号楼' : `${building}栋`
}

// —— 邮箱疑似手滑检测（与前端 utils/validators.js 的 emailSuspicion 保持一致）——
const EMAIL_PROVIDER_DOMAINS = Object.freeze({
  qq: ['qq.com'], '163': ['163.com'], '126': ['126.com'], yeah: ['yeah.net'],
  sina: ['sina.com', 'sina.cn'], gmail: ['gmail.com'], foxmail: ['foxmail.com'],
  outlook: ['outlook.com'], hotmail: ['hotmail.com'], '139': ['139.com'],
  '189': ['189.cn'], wo: ['wo.cn']
})
const SUSPICIOUS_TLDS = Object.freeze(['co', 'cm', 'con', 'comm', 'comn', 'om', 'c0m', 'conm'])

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

module.exports = {
  DORM_BUILDINGS,
  SHIPAI_DORM_BUILDINGS,
  SHIPAI_DORM_BUILDING_SET,
  MAX_ORDER_PIECES,
  MAX_PICKUP_IMAGES,
  MAX_DELIVERY_IMAGES,
  MAX_ITEMIZED_ORDER_ITEMS,
  normalizeDormBuilding,
  formatDormBuilding,
  emailSuspicion
}
