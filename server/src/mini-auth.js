const jwt = require('jsonwebtoken')
const config = require('./config')
const { pool } = require('./db')
const { HttpError, asyncRoute } = require('./http')

const TOKEN_OPTIONS = Object.freeze({
  algorithm: 'HS256',
  issuer: 'campus-express-api',
  audience: 'campus-express-mini'
})

function signToken(payload, subject, expiresIn) {
  return jwt.sign(payload, config.miniJwtSecret, Object.assign({}, TOKEN_OPTIONS, {
    subject: String(subject),
    expiresIn
  }))
}

function issueMiniToken(userId) {
  return signToken({ type: 'mini_user' }, userId, config.miniJwtExpiresIn)
}

function issueRegistrationToken(identity) {
  return signToken({
    type: 'mini_registration',
    unionid: String(identity.unionid || '')
  }, identity.openid, config.miniRegistrationExpiresIn)
}

function decodeExpiry(token) {
  const decoded = jwt.decode(token)
  return Number(decoded && decoded.exp) * 1000
}

function verifyToken(token, expectedType) {
  try {
    const payload = jwt.verify(token, config.miniJwtSecret, TOKEN_OPTIONS)
    if (!payload || payload.type !== expectedType || !payload.sub) throw new Error('invalid token payload')
    return payload
  } catch (error) {
    throw new HttpError(401, '登录状态已失效，请重新登录', 'MINI_TOKEN_EXPIRED')
  }
}

function readBearerToken(request) {
  const authorization = String(request.get('Authorization') || '')
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

const authenticateMini = asyncRoute(async (request, response, next) => {
  const token = readBearerToken(request)
  if (!token) throw new HttpError(401, '请先登录小程序', 'MINI_UNAUTHORIZED')
  const payload = verifyToken(token, 'mini_user')
  const [rows] = await pool.execute(
    `SELECT id, openid, unionid, nickname, phone, building, room, campus, address, status, created_at, updated_at
       FROM users
      WHERE id = ?
      LIMIT 1`,
    [String(payload.sub)]
  )
  const user = rows[0]
  if (!user || user.status !== 'active') {
    throw new HttpError(401, '用户账号不可用', 'MINI_ACCOUNT_DISABLED')
  }
  request.miniUser = user
  next()
})

module.exports = {
  authenticateMini,
  decodeExpiry,
  issueMiniToken,
  issueRegistrationToken,
  readBearerToken,
  verifyToken
}
