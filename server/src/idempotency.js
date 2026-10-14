const crypto = require('crypto')
const { pool } = require('./db')
const { HttpError, asyncRoute } = require('./http')

const ADMIN_TABLE = 'idempotency_keys'
const MINI_TABLE = 'mini_idempotency_keys'
// 表名会拼进 SQL，所以只允许这两个模块内常量。这里是唯一入口，别把外部输入传进来。
const TABLES = new Set([ADMIN_TABLE, MINI_TABLE])

function keyHash(principalId, request, key) {
  return crypto
    .createHash('sha256')
    .update(`${principalId}:${request.method}:${request.baseUrl}${request.path}:${key}`)
    .digest('hex')
}

// options:
//   table            目标表（必须是 TABLES 里的常量）
//   principalColumn  幂等主体列名：idempotency_keys 是 admin_id，mini_idempotency_keys 是 user_id。
//                    两张表的列名不同，不能共用同一个字面量。
//   principal        request => 幂等主体 id（管理员 id 或 mini 用户 id）
//   optional         true 时没带 Idempotency-Key 就直接放行、不查重
function createIdempotencyMiddleware(options) {
  const table = options.table
  if (!TABLES.has(table)) throw new Error(`unknown idempotency table: ${table}`)
  const principalColumn = options.principalColumn
  if (!['admin_id', 'user_id'].includes(principalColumn)) throw new Error(`unknown idempotency principal column: ${principalColumn}`)
  const principal = options.principal
  const optional = options.optional === true

  return asyncRoute(async (request, response, next) => {
    const key = String(request.get('Idempotency-Key') || '').trim()
    if (!key || key.length > 128) {
      // 小程序侧是 optional：客户端是已发布的版本，不能因为某个老版本没发这个头就把整条路由打死。
      if (optional) return next()
      throw new HttpError(400, '缺少有效的幂等请求标识', 'IDEMPOTENCY_KEY_REQUIRED')
    }
    const principalId = principal(request)
    const hash = keyHash(principalId, request, key)
    try {
      await pool.execute(
        `INSERT INTO ${table}
           (key_hash, ${principalColumn}, method, request_path, response_status, response_body, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, '', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE), UTC_TIMESTAMP())`,
        [hash, principalId, request.method, `${request.baseUrl}${request.path}`.slice(0, 255)]
      )
    } catch (error) {
      if (!error || error.code !== 'ER_DUP_ENTRY') throw error
      const [rows] = await pool.execute(
        `SELECT response_status, response_body
           FROM ${table}
          WHERE key_hash = ? AND expires_at > UTC_TIMESTAMP()
          LIMIT 1`,
        [hash]
      )
      if (!rows[0]) {
        await pool.execute(`DELETE FROM ${table} WHERE key_hash = ?`, [hash])
        throw new HttpError(409, '请求状态已过期，请重新操作', 'IDEMPOTENCY_EXPIRED')
      }
      if (Number(rows[0].response_status) === 0) {
        throw new HttpError(409, '相同操作正在处理中，请勿重复提交', 'IDEMPOTENCY_IN_PROGRESS')
      }
      let body
      try { body = JSON.parse(rows[0].response_body) } catch (parseError) { body = { code: 0, data: null } }
      return response.status(rows[0].response_status).json(body)
    }
    request.idempotencyHash = hash
    request.idempotencyTable = table
    next()
  })
}

// 管理台：Idempotency-Key 必填，沿用 idempotency_keys + admin_users 外键。
const requireIdempotency = createIdempotencyMiddleware({
  table: ADMIN_TABLE,
  principalColumn: 'admin_id',
  principal: request => request.admin.id
})

// 小程序：可选。带了才查重，没带就照旧直接执行。
// mini 路由只在 request.miniUser 上挂主体，没有 request.admin。
const requireMiniIdempotency = createIdempotencyMiddleware({
  table: MINI_TABLE,
  principalColumn: 'user_id',
  principal: request => request.miniUser.id,
  optional: true
})

async function sendIdempotent(request, response, data, status = 200) {
  const body = { code: 0, data }
  if (request.idempotencyHash) {
    if (!TABLES.has(request.idempotencyTable)) throw new Error(`unknown idempotency table: ${request.idempotencyTable}`)
    const [result] = await pool.execute(
      `UPDATE ${request.idempotencyTable}
          SET response_status = ?, response_body = ?, expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR)
        WHERE key_hash = ? AND response_status = 0`,
      [status, JSON.stringify(body), request.idempotencyHash]
    )
    if (result.affectedRows !== 1) throw new HttpError(409, '操作结果保存失败，请刷新后确认', 'IDEMPOTENCY_FINALIZE_FAILED')
    request.idempotencyCompleted = true
  }
  return response.status(status).json(body)
}

// 把 request 上挂的表名收敛回白名单：表名要拼进 SQL，错误处理路径也不能例外。
// 拿不到合法表名就返回 null，调用方跳过清理，绝不退化成拼接任意字符串。
function resolveIdempotencyTable(request) {
  return TABLES.has(request.idempotencyTable) ? request.idempotencyTable : null
}

// 回收两张幂等表里的过期行。
// 过期行不会再被任何请求命中（中间件只认 expires_at > UTC_TIMESTAMP()），
// 只有「恰好有人重放同一个旧 key」时才会被顺手删掉——正常情况等于永不回收，必须定期清。
// 分批删，避免一条 DELETE 锁住太多行；每张表各自走完自己的批次。
async function cleanupExpiredIdempotencyKeys(options) {
  const settings = options || {}
  const batchSize = Math.max(1, Math.floor(Number(settings.batchSize) || 1000))
  const maxBatches = Math.max(1, Math.floor(Number(settings.maxBatches) || 20))
  let deleted = 0
  for (const table of TABLES) {
    for (let batch = 0; batch < maxBatches; batch += 1) {
      const [result] = await pool.query(
        `DELETE FROM ${table} WHERE expires_at < UTC_TIMESTAMP() LIMIT ?`,
        [batchSize]
      )
      deleted += result.affectedRows
      if (result.affectedRows < batchSize) break
    }
  }
  if (deleted) console.log(JSON.stringify({ level: 'info', message: 'expired idempotency keys cleaned', deleted }))
  return deleted
}

module.exports = {
  requireIdempotency,
  requireMiniIdempotency,
  sendIdempotent,
  resolveIdempotencyTable,
  cleanupExpiredIdempotencyKeys
}
