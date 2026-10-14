const crypto = require('crypto')
const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
const config = require('./config')
const { pool } = require('./db')
const { asyncRoute, HttpError, ok } = require('./http')
const authRoutes = require('./routes/auth')
const adminRoutes = require('./routes/admin')
const miniRoutes = require('./routes/mini')
const paymentRoutes = require('./routes/payments')
const { runRefundSweep } = require('./refund-sweep')
const { processUrgentOrderAlerts } = require('./urgent-alert-sweep')
const { cleanupCancelledOrders, cleanupOrphanUploads } = require('./order-cleanup')
const { resolveIdempotencyTable, cleanupExpiredIdempotencyKeys } = require('./idempotency')
const { URGENT_ALERT_SCAN_INTERVAL_MS } = require('./urgent-alert-rules')
const { NEW_ORDER_RIDER_SCAN_INTERVAL_MS, processNewOrderRiderEmails } = require('./rider-notify')

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', config.trustProxy)

app.use((request, response, next) => {
  const incoming = String(request.get('X-Request-Id') || '').trim()
  request.id = /^[a-zA-Z0-9._:-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID()
  response.setHeader('X-Request-Id', request.id)
  next()
})
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }))
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === config.adminCorsOrigin) return callback(null, true)
    return callback(new HttpError(403, '不允许的跨域来源', 'CORS_ORIGIN_DENIED'))
  },
  methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
  allowedHeaders: ['Accept', 'Authorization', 'Content-Type', 'Idempotency-Key', 'X-Client-Env', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  maxAge: 600,
  credentials: false
}))
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' }
}))
app.use(express.json({ limit: '1mb', strict: true }))
app.use(express.urlencoded({ extended: true }))

app.get('/health', asyncRoute(async (request, response) => {
  await pool.query('SELECT 1')
  return ok(response, {
    status: 'ok',
    service: 'campus-express-api',
    environment: config.nodeEnv,
    time: new Date().toISOString()
  })
}))

app.use('/admin', (request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})
app.use('/admin/auth', authRoutes)
app.use('/admin', adminRoutes)

app.use('/mini', (request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})
app.use('/mini', miniRoutes)
app.use('/mini', paymentRoutes)

app.use((request, response, next) => {
  next(new HttpError(404, '接口不存在', 'ROUTE_NOT_FOUND'))
})

app.use(async (error, request, response, next) => {
  const status = Number(error.status) >= 400 && Number(error.status) < 600 ? Number(error.status) : 500
  const expected = error instanceof HttpError
  const malformedJson = error && error.type === 'entity.parse.failed'
  const tooLarge = status === 413
  const message = expected
    ? error.message
    : malformedJson
      ? '请求数据不是有效的JSON'
      : tooLarge
        ? '请求数据过大'
        : '服务暂时不可用，请稍后重试'
  const code = expected ? error.code : malformedJson ? 'INVALID_JSON' : tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL_SERVER_ERROR'
  const log = {
    level: status >= 500 ? 'error' : 'warn',
    requestId: request.id,
    method: request.method,
    path: request.originalUrl,
    status,
    code,
    message: error && error.message ? error.message : String(error)
  }
  if (!config.isProduction && error && error.stack) log.stack = error.stack
  console.error(JSON.stringify(log))
  if (response.headersSent) return next(error)
  // 表名必须跟着 request 走：管理台写 idempotency_keys，小程序写 mini_idempotency_keys。
  // 此前这里写死了 idempotency_keys，小程序请求出错时清不掉自己的占位行。
  const idempotencyTable = resolveIdempotencyTable(request)
  if (request.idempotencyHash && !request.idempotencyCompleted && idempotencyTable) {
    try {
      await pool.execute(
        `DELETE FROM ${idempotencyTable} WHERE key_hash = ? AND response_status = 0`,
        [request.idempotencyHash]
      )
    } catch (cleanupError) {
      console.error(JSON.stringify({ level: 'error', requestId: request.id, message: 'idempotency cleanup failed' }))
    }
  }
  return response.status(status).json({ code, message, requestId: request.id })
})

const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(JSON.stringify({
    level: 'info',
    message: 'campus-express-api started',
    host: '127.0.0.1',
    port: config.port,
    environment: config.nodeEnv
  }))
})

// 退款重试：递归 setTimeout，每 60 秒扫描一次，避免任务重叠。
// 已不再含「超时未接单自动取消」——2026-09-15 起只保留退款重试引擎。
function scheduleRefundSweep() {
  setTimeout(async () => {
    try {
      await runRefundSweep()
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'refund sweep failed', error: error.message }))
    }
    scheduleRefundSweep()
  }, 60 * 1000)
}
scheduleRefundSweep()

// 很急订单运营提醒：仅在邮件配置启用时，每 10 分钟扫描一次，递归调度避免任务重叠。
function scheduleUrgentAlertSweep() {
  setTimeout(async () => {
    try {
      await processUrgentOrderAlerts()
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'urgent order email sweep failed', error: error.message }))
    }
    scheduleUrgentAlertSweep()
  }, URGENT_ALERT_SCAN_INTERVAL_MS)
}
if (config.urgentEmail.enabled) scheduleUrgentAlertSweep()

// 骑手新单邮件：订单进入大厅（未支付→已支付，或免支付直接落单）就尽快提醒本校区骑手，
// 60 秒扫描一次，递归调度避免任务重叠。
function scheduleRiderNotifySweep() {
  setTimeout(async () => {
    try {
      await processNewOrderRiderEmails()
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'new order rider email sweep failed', error: error.message }))
    }
    scheduleRiderNotifySweep()
  }, NEW_ORDER_RIDER_SCAN_INTERVAL_MS)
}
if (config.urgentEmail.enabled) scheduleRiderNotifySweep()

// 24 小时一轮的定期清理。首次启动后 60 秒执行，之后每 24 小时一次。
// 三件事互不依赖，各自 try 住，免得一个失败把另外两个带停：
//   1) 取消超过 7 天的订单及关联数据
//   2) 孤儿上传（传成功但从没挂到订单上的图片）
//   3) 两张幂等表里的过期行（过期行永远不会被请求命中，不主动删就只增不减）
function scheduleOrderCleanup(firstRun) {
  setTimeout(async () => {
    try {
      await cleanupCancelledOrders()
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'order cleanup sweep failed', error: error.message }))
    }
    try {
      await cleanupOrphanUploads()
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'orphan upload sweep failed', error: error.message }))
    }
    try {
      await cleanupExpiredIdempotencyKeys()
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', message: 'idempotency cleanup sweep failed', error: error.message }))
    }
    scheduleOrderCleanup(false)
  }, firstRun === false ? 24 * 60 * 60 * 1000 : 60 * 1000)
}
scheduleOrderCleanup()

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(JSON.stringify({ level: 'info', message: 'shutdown requested', signal }))
  const forceTimer = setTimeout(() => process.exit(1), 10000)
  forceTimer.unref()
  server.close(async error => {
    try { await pool.end() } catch (poolError) { console.error(JSON.stringify({ level: 'error', message: 'pool end failed', error: String(poolError) })) }
    if (error) console.error(JSON.stringify({ level: 'error', message: 'server close error', error: String(error) }))
    process.exit(error ? 1 : 0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('unhandledRejection', error => {
  console.error(JSON.stringify({ level: 'error', message: 'unhandledRejection', error: String(error) }))
})
process.on('uncaughtException', error => {
  console.error(JSON.stringify({ level: 'error', message: 'uncaughtException', error: String(error), stack: error.stack }))
  shutdown('uncaughtException')
})

module.exports = { app, server }
