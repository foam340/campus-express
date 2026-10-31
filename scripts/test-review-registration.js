const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { REVIEW_REGISTRATION_PROFILE } = require('../config/business')
const { DEFAULT_CAMPUS, getCampusConfig } = require('../server/src/campus-config')
const root = path.resolve(__dirname, '..')

function load(file, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
    module, exports: module.exports, console, ...globals,
    require(name) { return Object.prototype.hasOwnProperty.call(dependencies, name) ? dependencies[name] : require(path.resolve(root, path.dirname(file), name)) }
  }, { filename: file })
  return module.exports
}

function harness(existingUser) {
  const users = existingUser ? [{ ...existingUser }] : []
  const requests = [], writes = [], routes = new Map(), storage = new Map()
  const registrationToken = 'fixture-registration-token-not-valid-in-production'
  const openid = 'fixture-wechat-identity'
  const expiresAt = Date.now() + 3600000
  const wx = {
    login(options) { options.success({ code: 'fixture-wechat-code' }) },
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value),
    removeStorageSync: key => storage.delete(key)
  }
  const connection = { async execute(sql, values) {
    if (sql.includes('FROM users u')) {
      return [users.filter(user => sql.includes('WHERE u.openid') ? user.openid === values[0] : user.id === values[0])]
    }
    if (sql.includes('INSERT INTO users')) {
      const [identity, unionid, nickname, phone, building, room, campus, address] = values
      const user = { id: 900000001, openid: identity, unionid, nickname, phone, building, room, campus, address, status: 'active' }
      users.push(user)
      writes.push('insert')
      return [{ insertId: user.id }]
    }
    if (sql.includes('UPDATE users')) {
      writes.push('update')
      throw new Error('Unexpected existing-user mutation')
    }
    throw new Error('Unexpected registration SQL')
  } }
  const router = {}
  for (const method of ['get', 'post', 'put']) router[method] = (route, ...handlers) => routes.set(method + ':' + route, handlers.at(-1))
  const actual = ['http', 'validation', 'business-rules', 'campus-config', 'item-pricing', 'order-privacy', 'rider-level']
  load('server/src/routes/mini.js', {
    express: { Router: () => router }, crypto: require('node:crypto'), 'express-rate-limit': () => () => {},
    '../db': { pool: connection, transaction: callback => callback(connection) },
    '../wechat': { code2Session: async () => ({ openid }) },
    '../mini-auth': {
      issueRegistrationToken: () => registrationToken,
      verifyToken(token, type) {
        assert.equal(token, registrationToken)
        assert.equal(type, 'mini_registration')
        return { sub: openid }
      },
      issueMiniToken: () => 'fixture-access-token-not-valid-in-production', decodeExpiry: () => expiresAt
    },
    ...Object.fromEntries(actual.map(name => ['../' + name, require('../server/src/' + name)])),
    '../idempotency': {}, '../audit': {}, '../campus-change': {}, '../uploads': {}, '../thumbnail': {},
    '../payment-refunds': {}, '../urgent-alert-queue': {}, '../rider-notify': {}
  })
  const invoke = (route, body) => new Promise((resolve, reject) => {
    let status
    routes.get('post:' + route)({ body }, { status(value) { status = value; return this }, json(value) { resolve({ status, ...value }) } }, reject)
  })
  const session = load('utils/session.js', {}, { wx })
  const miniAuth = load('utils/mini-auth.js', {
    './session': session,
    './request': { async request(options) {
      requests.push(options)
      const result = await invoke(options.url.replace('/mini', ''), options.data)
      return result.data
    } }
  }, { wx })
  return { miniAuth, session, users, requests, writes, invoke, registrationToken }
}

async function main() {
  assert.equal(REVIEW_REGISTRATION_PROFILE.campus, DEFAULT_CAMPUS)
  const fresh = harness()
  let resolveSettings
  const ready = new Promise(resolve => { resolveSettings = resolve })
  const authentication = fresh.miniAuth.bootstrap(null, { reviewProfile: REVIEW_REGISTRATION_PROFILE, ready })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fresh.requests.length, 1, 'Login may run before settings; registration must wait')
  resolveSettings({ reviewMode: true })
  const registered = await authentication
  assert.equal(registered.registered, true)
  assert.equal(registered.user.campus, DEFAULT_CAMPUS)
  assert.equal(registered.user.building, '1栋')
  assert.equal(registered.user.room, '111')
  assert.deepEqual(fresh.writes, ['insert'])
  assert.equal(fresh.requests[1].data.campus, DEFAULT_CAMPUS)
  assert.equal(fresh.users[0].campus, DEFAULT_CAMPUS, 'Actual backend registration route must store the campus')
  assert(fresh.session.getAccessToken(), 'Successful bootstrap must store an access session')
  assert.equal(fresh.session.getRegistrationToken(), '')

  const legacy = { ...REVIEW_REGISTRATION_PROFILE }
  delete legacy.campus
  for (const campus of [undefined, '', 'unknown']) {
    const invalid = harness()
    const profile = { ...legacy, registrationToken: invalid.registrationToken }
    if (campus !== undefined) profile.campus = campus
    await assert.rejects(invalid.invoke('/auth/register', profile), error => error.status === 400 && error.code === 'INVALID_CAMPUS')
    assert.equal(invalid.writes.length, 0, 'Missing/invalid campus must still be rejected by the unchanged backend')
  }
  for (const reviewMode of [false, undefined]) {
    const normal = harness()
    const result = await normal.miniAuth.bootstrap(null, { reviewProfile: REVIEW_REGISTRATION_PROFILE, ready: Promise.resolve({ reviewMode }) })
    assert.equal(result.registered, false)
    assert.equal(normal.requests.length, 1)
    assert.equal(normal.writes.length, 0, 'Normal or unconfirmed mode must not auto-register review data')
  }
  for (const campus of ['nanhai', 'shipai', 'gqg']) {
    const current = { id: 900000002, openid: 'fixture-wechat-identity', nickname: 'Existing fixture', phone: '13800000001',
      building: campus === 'shipai' ? getCampusConfig(campus).buildingKeys[0] : '2', room: '222', campus, status: 'active' }
    const existing = harness(current)
    const before = JSON.stringify(existing.users)
    const result = await existing.miniAuth.bootstrap(null, { reviewMode: true, reviewProfile: REVIEW_REGISTRATION_PROFILE })
    assert.equal(result.user.campus, campus)
    assert.equal(existing.requests.length, 1)
    assert.equal(existing.writes.length, 0)
    assert.equal(JSON.stringify(existing.users), before, 'Review bootstrap must preserve existing accounts in every campus')

    const manual = harness()
    const resultManual = await manual.miniAuth.register({ name: '手动测试', phone: '13800000002', campus,
      building: campus === 'shipai' ? getCampusConfig(campus).buildingKeys[0] : '2栋', room: '222' })
    assert.equal(resultManual.registered, true)
    assert.equal(resultManual.user.campus, campus, 'Normal manual registration remains campus-specific')
  }
  const eastOneProfile = { name: '新楼测试', phone: '13800000002', campus: 'gqg', building: '东一栋', room: '222' }
  assert.equal(require('../utils/validators').validateRegistration(eastOneProfile), '')
  const eastOne = harness()
  const eastOneResult = await eastOne.miniAuth.register(eastOneProfile)
  assert.equal(eastOneResult.user.building, '东1栋', 'Legacy named GQG building must display the new name')
  assert.equal(eastOne.users[0].building, '东一', 'Keep the named building separate from numeric building 1')
  for (const building of ['东1栋', '东2栋']) {
    const profile = { ...eastOneProfile, building }
    assert.equal(require('../utils/validators').validateRegistration(profile), '')
    const registration = harness()
    const result = await registration.miniAuth.register(profile)
    assert.equal(result.user.building, building)
    assert.equal(registration.users[0].building, building === '东1栋' ? '东一' : '东2')
  }
  for (const campus of ['nanhai', 'shipai']) {
    const invalidEastOne = harness()
    await assert.rejects(invalidEastOne.invoke('/auth/register', {
      ...eastOneProfile, campus, registrationToken: invalidEastOne.registrationToken
    }), error => error.code === 'INVALID_BUILDING')
    assert.equal(invalidEastOne.writes.length, 0)
  }
  for (const building of ['教师公寓A座', '教师公寓B座']) {
    const profile = { ...eastOneProfile, campus: 'nanhai', building }
    assert.equal(require('../utils/validators').validateRegistration(profile), '')
    const registration = harness()
    const result = await registration.miniAuth.register(profile)
    assert.equal(result.user.building, building, 'Teacher apartment name must not gain a 栋 suffix')
    assert.equal(registration.users[0].building, building)
    assert(getCampusConfig('nanhai').grabRules.genderRestriction.exemptBuildings.includes(building))
    for (const campus of ['shipai', 'gqg']) {
      const rejected = harness()
      await assert.rejects(rejected.invoke('/auth/register', {
        ...profile, campus, registrationToken: rejected.registrationToken
      }), error => error.code === 'INVALID_BUILDING')
      assert.equal(rejected.writes.length, 0)
    }
  }
  console.log('Review registration checks passed: real client bootstrap/session and backend route validation, default campus persistence, strict campus rejection, normal-mode isolation, existing users in three campuses and GQG East One building round-trip.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
