const jwt = require('jsonwebtoken')
const { pool } = require('./db')
const config = require('./config')
const { HttpError, asyncRoute } = require('./http')
const { isKnownCampus } = require('./campus-config')

function parseRoles(value) {
  try {
    const roles = JSON.parse(String(value || '[]'))
    return Array.isArray(roles) ? roles.map(String) : []
  } catch (error) {
    return []
  }
}

const authenticateAdmin = asyncRoute(async (request, response, next) => {
  const authorization = String(request.get('Authorization') || '')
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (!match) throw new HttpError(401, '请先登录管理台', 'ADMIN_UNAUTHORIZED')

  let payload
  try {
    payload = jwt.verify(match[1], config.adminJwtSecret, {
      algorithms: ['HS256'],
      issuer: 'campus-express-api',
      audience: 'campus-express-admin'
    })
  } catch (error) {
    throw new HttpError(401, '登录已过期，请重新登录', 'ADMIN_TOKEN_EXPIRED')
  }

  if (payload.type !== 'admin' || !payload.sub) {
    throw new HttpError(401, '登录凭证无效', 'ADMIN_TOKEN_INVALID')
  }

  const [rows] = await pool.execute(
    `SELECT id, username, display_name, roles_json, status, campus
       FROM admin_users
      WHERE id = ?
      LIMIT 1`,
    [String(payload.sub)]
  )
  const account = rows[0]
  if (!account || account.status !== 'active') {
    throw new HttpError(401, '管理员账号不可用', 'ADMIN_ACCOUNT_DISABLED')
  }

  request.admin = {
    id: String(account.id),
    username: account.username,
    name: account.display_name,
    roles: parseRoles(account.roles_json),
    campus: isKnownCampus(account.campus) ? account.campus : null
  }
  next()
})

function requireRoles(...allowedRoles) {
  const allowed = new Set(allowedRoles)
  return (request, response, next) => {
    const roles = request.admin && Array.isArray(request.admin.roles) ? request.admin.roles : []
    if (roles.includes('super_admin') || roles.some(role => allowed.has(role))) return next()
    return next(new HttpError(403, '当前账号没有此操作权限', 'ADMIN_FORBIDDEN'))
  }
}

function issueAdminToken(admin) {
  return jwt.sign(
    { type: 'admin', roles: admin.roles },
    config.adminJwtSecret,
    {
      algorithm: 'HS256',
      subject: String(admin.id),
      issuer: 'campus-express-api',
      audience: 'campus-express-admin',
      expiresIn: config.adminJwtExpiresIn
    }
  )
}

module.exports = { authenticateAdmin, issueAdminToken, parseRoles, requireRoles }
