const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')

function load(file, dependencies, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module, exports: module.exports, console, ...globals,
    require(name) {
      if (Object.prototype.hasOwnProperty.call(dependencies, name)) return dependencies[name]
      return require(name.startsWith('.') ? path.resolve(root, path.dirname(file), name) : name)
    }
  }, { filename: file })
  return module.exports
}

function notificationHarness(options = {}) {
  const jobs = [], mails = [], logs = [], reads = []
  const config = {
    urgentEmail: { enabled: options.enabled !== false },
    withdrawalRequestEmailTo: options.to === undefined ? 'owner@example.com' : options.to,
    adminCorsOrigin: 'https://admin.example.com'
  }
  const notifier = load('server/src/rider-notify.js', {
    './config': config,
    './db': { pool: { async execute(sql, params) {
      reads.push({ sql, params })
      if (options.dbError) throw Object.assign(new Error('private db details'), { code: 'DB_UNAVAILABLE' })
      return [options.skip ? [] : [{
        id: params[0], rider_id: 7, amount: '68.50', name: '昵称', name_note: '骑手备注',
        campus: options.campus || 'nanhai', requested_cn: '2026-10-26 21:00:01'
      }]]
    } } },
    './urgent-email': { async sendWithdrawalRequestEmail(message) {
      mails.push(message)
      if (options.send) return options.send(message)
      return { ok: true, code: 'ACCEPTED' }
    } }
  }, {
    setImmediate: callback => jobs.push(callback),
    console: { log: line => logs.push(JSON.parse(line)), error: line => logs.push(JSON.parse(line)) }
  })
  return { notifier, jobs, mails, logs, reads }
}

async function testNotifications() {
  for (const campus of ['nanhai', 'shipai', 'gqg']) {
    const h = notificationHarness({ campus })
    h.notifier.notifyWithdrawalRequest('42')
    assert.equal(h.jobs.length, 1)
    assert.equal(h.reads.length, 0, 'Database and SMTP work must be deferred')
    await h.jobs.shift()()
    assert.equal(h.mails.length, 1)
    assert.match(h.mails[0].subject, /68\.50/)
    assert.match(h.mails[0].text, /骑手备注/)
    assert.match(h.mails[0].text, /提现编号：42/)
    assert.match(h.mails[0].text, /2026-10-26 21:00:01（北京时间）/)
    assert.match(h.mails[0].text, /https:\/\/admin\.example\.com/)
    assert.match(h.reads[0].sql, /settings\.review_mode = 0/)
    assert.match(h.reads[0].sql, /w\.status = 'pending'/)
    assert(!h.reads[0].sql.includes('service_status'), 'Closing new orders must not suppress withdrawal reminders')
    assert.equal(h.jobs.length, 0, 'No periodic scans or retry timers')
  }
  for (const options of [{ enabled: false }, { to: '' }]) {
    const h = notificationHarness(options)
    h.notifier.notifyWithdrawalRequest('42')
    assert.equal(h.jobs.length, 0)
  }
  for (const options of [
    { skip: true },
    { dbError: true },
    { send: async () => ({ ok: false, code: 'SMTP_550' }) },
    { send: async () => { throw Object.assign(new Error('sensitive SMTP details'), { code: 'ETIMEDOUT' }) } }
  ]) {
    const h = notificationHarness(options)
    h.notifier.notifyWithdrawalRequest('42')
    await h.jobs.shift()()
    assert.equal(h.jobs.length, 0, 'Failure must not schedule another send')
    assert(!JSON.stringify(h.logs).includes('sensitive SMTP details'))
    assert(!JSON.stringify(h.logs).includes('private db details'))
    if (options.skip || options.dbError) assert.equal(h.mails.length, 0)
    else assert.equal(h.mails.length, 1)
  }
  let finishSend
  const h = notificationHarness({ send: () => new Promise(resolve => { finishSend = resolve }) })
  h.notifier.notifyWithdrawalRequest('42')
  const running = h.jobs.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.mails.length, 1)
  assert.equal(h.logs.length, 0, 'A slow SMTP response remains entirely in the deferred callback')
  finishSend({ ok: true, code: 'ACCEPTED' })
  await running
}

async function testTransport() {
  const calls = []
  let behavior = async () => ({ accepted: ['owner@example.com'], response: '250 OK', messageId: 'fixture' })
  const config = {
    urgentEmail: { enabled: true, from: 'sender@example.com', to: 'existing-alert@example.com' },
    withdrawalRequestEmailTo: 'owner@example.com'
  }
  const transport = load('server/src/urgent-email.js', {
    './config': config,
    nodemailer: { createTransport: () => ({ sendMail: options => { calls.push(options); return behavior() } }) }
  })
  assert.equal((await transport.sendWithdrawalRequestEmail({ subject: '申请', text: '提醒' })).ok, true)
  assert.equal(calls[0].to, 'owner@example.com')
  assert.equal(calls[0].headers['X-Campus-Notification'], 'withdrawal-request-email')
  await transport.sendRiderWithdrawalEmail('rider@example.com', { subject: '结清', text: '原回执' })
  assert.equal(calls[1].to, 'rider@example.com')
  assert.equal(calls[1].headers['X-Campus-Notification'], 'rider-withdrawal-email')
  await transport.sendUrgentOrderEmail('ORDER42', { subject: '原紧急提醒', text: '提醒' })
  assert.equal(calls[2].to, 'existing-alert@example.com')
  behavior = async () => { throw Object.assign(new Error('private SMTP reply'), { responseCode: 550 }) }
  assert.equal((await transport.sendWithdrawalRequestEmail({})).code, 'SMTP_550')
  behavior = async () => { throw Object.assign(new Error('private SMTP details'), { code: 'ETIMEDOUT' }) }
  await assert.rejects(transport.sendWithdrawalRequestEmail({}), error => error.code === 'ETIMEDOUT')
  const previous = calls.length
  config.withdrawalRequestEmailTo = 'invalid\r\nrecipient'
  assert.equal((await transport.sendWithdrawalRequestEmail({})).code, 'INVALID_RECIPIENT')
  assert.equal(calls.length, previous)
}

function routeHarness(options = {}) {
  const routes = new Map(), cached = new Map(), reminders = [], withdrawals = []
  let committed = false
  const connection = { async execute(sql, values) {
    if (sql.includes('FROM riders') && sql.includes('WHERE user_id')) return [options.noRider ? [] : [{ id: 7, campus: 'nanhai' }]]
    if (sql.includes('SELECT available_balance')) return [[{ available_balance: options.balance === undefined ? '68.50' : options.balance }]]
    if (sql.includes('SELECT COUNT(*) AS total FROM withdrawals')) return [[{ total: options.count || 0 }]]
    if (sql.includes('INSERT INTO withdrawals')) {
      withdrawals.push({ riderId: values[0], amount: values[1] })
      return [{ insertId: 42 }]
    }
    if (sql.includes('FROM orders') && sql.includes("status = 'unpaid'")) return [[]]
    if (/^\s*(UPDATE|INSERT INTO rider_experience_events)/.test(sql)) return [{ affectedRows: 0 }]
    throw new Error('Unexpected withdrawal SQL')
  } }
  const pool = { async execute(sql, values) {
    if (sql.includes('INSERT INTO mini_idempotency_keys')) {
      if (cached.has(values[0])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
      cached.set(values[0], { response_status: 0, response_body: '' })
      return [{ affectedRows: 1 }]
    }
    if (sql.includes('SELECT response_status')) return [[cached.get(values[0])]]
    if (sql.includes('UPDATE mini_idempotency_keys')) {
      cached.set(values[2], { response_status: values[0], response_body: values[1] })
      return [{ affectedRows: 1 }]
    }
    throw new Error('Unexpected idempotency SQL')
  } }
  const db = { pool, async transaction(handler) {
    const result = await handler(connection)
    if (options.failCommit) throw new Error('fixture transaction rollback')
    committed = true
    return result
  } }
  const idempotency = load('server/src/idempotency.js', { './db': db })
  const router = {}
  for (const method of ['get', 'post', 'put']) router[method] = (url, ...handlers) => routes.set(`${method}:${url}`, handlers)
  const noop = (request, response, next) => next()
  const actual = new Set(['http', 'validation', 'business-rules', 'campus-config', 'item-pricing', 'order-privacy', 'rider-level'])
  const dependencies = {
    express: { Router: () => router }, 'express-rate-limit': () => noop,
    '../db': db, '../idempotency': idempotency,
    '../mini-auth': { authenticateMini: noop },
    '../rider-notify': { notifyWithdrawalRequest(id) {
      assert(committed, 'Email may only be scheduled after transaction commit')
      reminders.push(id)
    } }
  }
  for (const name of ['audit', 'campus-change', 'wechat', 'uploads', 'thumbnail', 'payment-refunds', 'urgent-alert-queue']) dependencies['../' + name] = {}
  for (const name of actual) dependencies['../' + name] = require('../server/src/' + name)
  load('server/src/routes/mini.js', dependencies)
  const invoke = (key = 'same-submit') => new Promise((resolve, reject) => {
    const req = {
      method: 'POST', baseUrl: '/mini', path: '/rider/withdrawals',
      miniUser: { id: 9, campus: 'nanhai' }, body: { amount: 0.01 }, get: () => key
    }
    let status, index = 0
    const res = { status(value) { status = value; return this }, json(body) { resolve({ status, body }) } }
    const handlers = routes.get('post:/rider/withdrawals')
    const next = error => { if (error) reject(error); else handlers[index++](req, res, next) }
    next()
  })
  return { invoke, withdrawals, reminders }
}

async function testRoute() {
  const h = routeHarness()
  const first = await h.invoke()
  assert.equal(first.status, 201)
  assert.equal(first.body.data.withdrawal.amount, 68.5, 'Amount must remain the server full balance')
  assert.deepEqual(Object.keys(first.body.data.withdrawal).sort(), ['amount', 'id', 'status'])
  assert.deepEqual(h.reminders, ['42'])
  assert.equal(h.withdrawals.length, 1)
  const replay = await h.invoke()
  assert.equal(JSON.stringify(replay), JSON.stringify(first))
  assert.equal(h.withdrawals.length, 1, 'Actual idempotency middleware must replay the existing withdrawal')
  assert.equal(h.reminders.length, 1, 'Idempotent replay must not send another email')
  for (const options of [{ balance: 0 }, { count: 5 }, { noRider: true }, { failCommit: true }]) {
    const failed = routeHarness(options)
    await assert.rejects(failed.invoke())
    assert.equal(failed.reminders.length, 0, 'Rejected or rolled-back requests must not send')
  }
}

async function main() {
  await testNotifications()
  await testTransport()
  await testRoute()
  console.log('Withdrawal request email checks passed: commit-only event, unchanged response/full balance, idempotent replay, three campuses, review guard, slow/failed SMTP isolation, no retries and preserved existing mail recipients.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
