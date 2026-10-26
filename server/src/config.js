const path = require('path')
const dotenv = require('dotenv')

dotenv.config({ path: path.resolve(__dirname, '..', '.env'), quiet: true })

function integer(name, fallback, min, max) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 配置无效`)
  }
  return value
}

function required(name) {
  const value = String(process.env[name] || '').trim()
  if (!value || /REPLACE_WITH|change_this/i.test(value)) throw new Error(`${name} 尚未配置`)
  return value
}

function enabled(name, fallback = false) {
  const raw = String(process.env[name] == null ? fallback : process.env[name]).trim().toLowerCase()
  if (!['true', 'false'].includes(raw)) throw new Error(`${name} 配置无效`)
  return raw === 'true'
}

const nodeEnv = String(process.env.NODE_ENV || 'development')
const jwtSecret = required('ADMIN_JWT_SECRET')
if (Buffer.byteLength(jwtSecret, 'utf8') < 32) throw new Error('ADMIN_JWT_SECRET 至少需要32字节')
const jwtExpiresIn = String(process.env.ADMIN_JWT_EXPIRES_IN || '2h').trim()
if (!/^\d+(s|m|h|d)$/.test(jwtExpiresIn)) throw new Error('ADMIN_JWT_EXPIRES_IN 配置无效')

const miniJwtSecret = required('MINI_JWT_SECRET')
if (Buffer.byteLength(miniJwtSecret, 'utf8') < 32) throw new Error('MINI_JWT_SECRET 至少需要32字节')
const miniJwtExpiresIn = String(process.env.MINI_JWT_EXPIRES_IN || '7d').trim()
if (!/^\d+(s|m|h|d)$/.test(miniJwtExpiresIn)) throw new Error('MINI_JWT_EXPIRES_IN 配置无效')
const miniRegistrationExpiresIn = String(process.env.MINI_REGISTRATION_EXPIRES_IN || '15m').trim()
if (!/^\d+(s|m|h|d)$/.test(miniRegistrationExpiresIn)) throw new Error('MINI_REGISTRATION_EXPIRES_IN 配置无效')

const wechatAppId = required('WECHAT_APP_ID')
if (!/^wx[a-zA-Z0-9]{16}$/.test(wechatAppId)) throw new Error('WECHAT_APP_ID 配置无效')
const wechatAppSecret = required('WECHAT_APP_SECRET')
if (Buffer.byteLength(wechatAppSecret, 'utf8') < 16) throw new Error('WECHAT_APP_SECRET 配置无效')

const uploadDir = path.resolve(String(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')))
const urgentEmailEnabled = enabled('URGENT_EMAIL_ENABLED', false)
const urgentEmail = urgentEmailEnabled
  ? {
      enabled: true,
      host: required('SMTP_HOST'),
      port: integer('SMTP_PORT', 465, 1, 65535),
      secure: enabled('SMTP_SECURE', true),
      user: required('SMTP_USER'),
      pass: required('SMTP_PASS'),
      from: required('SMTP_FROM'),
      to: required('URGENT_EMAIL_TO')
    }
  : { enabled: false, host: '', port: 0, secure: true, user: '', pass: '', from: '', to: '' }
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
if (urgentEmail.enabled && (!/^[a-zA-Z0-9.-]{1,253}$/.test(urgentEmail.host) || urgentEmail.host.includes('..'))) throw new Error('SMTP_HOST 配置无效')
if (urgentEmail.enabled && !emailPattern.test(urgentEmail.from)) throw new Error('SMTP_FROM 配置无效')
if (urgentEmail.enabled && !emailPattern.test(urgentEmail.to)) throw new Error('URGENT_EMAIL_TO 配置无效')

module.exports = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: integer('PORT', 5500, 1024, 65535),
  trustProxy: integer('TRUST_PROXY', 1, 0, 10),
  db: {
    host: String(process.env.DB_HOST || '127.0.0.1'),
    port: integer('DB_PORT', 3306, 1, 65535),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    connectionLimit: integer('DB_CONNECTION_LIMIT', 10, 1, 50)
  },
  adminJwtSecret: jwtSecret,
  adminJwtExpiresIn: jwtExpiresIn,
  miniJwtSecret,
  miniJwtExpiresIn,
  miniRegistrationExpiresIn,
  wechatAppId,
  wechatAppSecret,
  wechatRequestTimeout: integer('WECHAT_REQUEST_TIMEOUT', 8000, 3000, 20000),
  uploadDir,
  uploadMaxFileBytes: integer('UPLOAD_MAX_FILE_BYTES', 5 * 1024 * 1024, 128 * 1024, 10 * 1024 * 1024),
  adminCorsOrigin: required('ADMIN_CORS_ORIGIN'),
  manualPayoutMode: String(process.env.MANUAL_PAYOUT_MODE || 'false') === 'true',
  urgentEmail: Object.freeze(urgentEmail),
  withdrawalRequestEmailTo: String(process.env.WITHDRAWAL_REQUEST_EMAIL_TO || '').trim(),
  logLevel: String(process.env.LOG_LEVEL || 'info')
})
