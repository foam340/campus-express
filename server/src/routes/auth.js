const express = require('express')
const bcrypt = require('bcryptjs')
const rateLimit = require('express-rate-limit')
const { pool } = require('../db')
const { asyncRoute, HttpError, ok } = require('../http')
const { issueAdminToken, parseRoles } = require('../auth')
const { string } = require('../validation')
const { isKnownCampus } = require('../campus-config')

const router = express.Router()
const dummyPasswordHash = bcrypt.hashSync('campus-express-invalid-login-sentinel', 12)

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'LOGIN_RATE_LIMITED', message: '登录尝试过多，请15分钟后再试' }
})

router.post('/login', loginLimiter, asyncRoute(async (request, response) => {
  const username = string(request.body && request.body.username, '账号', { min: 3, max: 64 })
  const password = string(request.body && request.body.password, '密码', { min: 7, max: 128 })
  const [rows] = await pool.execute(
    `SELECT id, username, password_hash, display_name, roles_json, status, campus
       FROM admin_users
      WHERE username = ?
      LIMIT 1`,
    [username]
  )
  const account = rows[0]
  const passwordMatches = await bcrypt.compare(password, account ? account.password_hash : dummyPasswordHash)
  const valid = Boolean(account && account.status === 'active' && passwordMatches)
  if (!valid) throw new HttpError(401, '账号或密码不正确', 'ADMIN_LOGIN_FAILED')

  const admin = {
    id: String(account.id),
    name: account.display_name,
    roles: parseRoles(account.roles_json),
    campus: isKnownCampus(account.campus) ? account.campus : null
  }
  const token = issueAdminToken(admin)
  const decoded = require('jsonwebtoken').decode(token)
  await pool.execute(
    'UPDATE admin_users SET last_login_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?',
    [account.id]
  )
  return ok(response, { token, expiresAt: Number(decoded && decoded.exp) * 1000, admin })
}))

module.exports = router
