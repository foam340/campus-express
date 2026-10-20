const assert = require('assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const { autoChangeCampus, lockCampusUser } = require('../server/src/campus-change')
const { CAMPUSES, ROUTES } = require('../config/constants')

function fixture(campus, rider = false) {
  const db = {
    users: [{ id: 1, campus, status: 'active', building: '1', room: '101', address: '旧地址' }],
    riders: rider ? [{ id: 2, user_id: 1, campus, status: 'approved', available_balance: 8 }] : [],
    orders: [], applications: [{ id: 3, user_id: 1, campus, status: 'pending' }],
    requests: [{ id: 4, user_id: 1, from_campus: campus, to_campus: 'shipai', status: 'pending' }], afterSales: []
  }
  const statements = []
  const connection = { async execute(sql, values) {
    const text = sql.replace(/\s+/g, ' ').trim()
    statements.push(text)
    if (text.startsWith('SELECT * FROM users')) return [db.users.filter(row => row.id === values[0])]
    if (text.startsWith('SELECT id FROM riders')) return [db.riders.filter(row => row.user_id === values[0])]
    if (text.startsWith('SELECT o.id FROM orders')) {
      const column = text.includes('WHERE o.user_id') ? 'user_id' : 'rider_id'
      return [db.orders.filter(row => {
        if (row[column] !== values[0] || ['completed', 'cancelled'].includes(row.status)) return false
        const claims = db.afterSales.filter(item => item.order_id === row.id)
        return !(row.status === 'disputed' && claims.some(item => item.status === 'resolved') && claims.every(item => item.status === 'resolved'))
      }).slice(0, 1)]
    }
    if (text.startsWith('UPDATE users')) {
      Object.assign(db.users.find(row => row.id === values[1]), { campus: values[0], building: '', room: '', address: '' })
    } else if (text.startsWith('UPDATE riders')) {
      db.riders.filter(row => row.user_id === values[1]).forEach(row => { row.campus = values[0] })
    } else if (text.startsWith('UPDATE rider_applications')) {
      db.applications.filter(row => row.user_id === values[1] && row.status === 'pending').forEach(row => { row.campus = values[0] })
    } else if (text.startsWith('UPDATE campus_change_requests')) {
      db.requests.filter(row => row.user_id === values[0] && row.status === 'pending').forEach(row => { row.status = 'rejected' })
    } else if (text.startsWith('INSERT INTO campus_change_requests')) {
      db.requests.push({ id: 5, user_id: values[0], from_campus: values[1], to_campus: values[2], reason: values[3], status: 'approved' })
      return [{ insertId: 5 }]
    } else throw new Error('Unexpected query: ' + text)
    return [{ affectedRows: 1 }]
  } }
  return { db, connection, statements }
}

async function testEligibility() {
  const blocked = ['unpaid', 'waiting', 'accepted', 'picked', 'delivering', 'delivered', 'disputed']
  for (const from of CAMPUSES) for (const to of CAMPUSES.filter(campus => campus !== from)) {
    for (const isRider of [false, true]) {
      const { db, connection, statements } = fixture(from, isRider)
      db.orders.push({ id: 'closed', user_id: 1, rider_id: 2, campus: from, status: 'completed' },
        { id: 'cancelled', user_id: 1, rider_id: 2, campus: from, status: 'cancelled' })
      const historical = JSON.stringify(db.orders)
      const result = await autoChangeCampus(connection, 1, to, '搬校区', from)
      assert.equal(result.status, 'approved')
      assert.equal(result.fromCampus, from)
      assert.equal(result.toCampus, to)
      assert.equal(db.users[0].campus, to)
      assert.equal(db.users[0].building + db.users[0].room + db.users[0].address, '')
      if (isRider) { assert.equal(db.riders[0].campus, to); assert.equal(db.riders[0].available_balance, 8) }
      assert.equal(db.applications[0].campus, to)
      assert.equal(db.requests[0].status, 'rejected')
      assert.equal(db.requests[1].status, 'approved')
      assert.equal(JSON.stringify(db.orders), historical)
      assert.match(statements[0], /^SELECT \* FROM users.*FOR UPDATE$/)
    }
    for (const status of blocked) for (const asRider of [false, true]) {
      const { db, connection } = fixture(from, true)
      db.riders[0].status = 'suspended'
      db.orders.push({ id: 'open', user_id: asRider ? 99 : 1, rider_id: asRider ? 2 : 99, status })
      const before = JSON.stringify(db)
      await assert.rejects(autoChangeCampus(connection, 1, to, '搬校区', from), error =>
        error.code === (asRider ? 'CAMPUS_CHANGE_HAS_RIDER_TASKS' : 'CAMPUS_CHANGE_HAS_OPEN_ORDERS'))
      assert.equal(JSON.stringify(db), before, 'Rejected change must preserve campus, address, tasks and pending request')
    }
  }
  for (const target of ['nanhai', 'invalid']) {
    const { connection } = fixture('nanhai')
    await assert.rejects(autoChangeCampus(connection, 1, target, '测试', 'nanhai'), error =>
      error.code === (target === 'invalid' ? 'INVALID_CAMPUS' : 'INVALID_CAMPUS_CHANGE'))
  }
  const { connection } = fixture('shipai')
  await assert.rejects(lockCampusUser(connection, 1, 'nanhai'), error => error.code === 'CAMPUS_CHANGED')
}

async function testClient() {
  const source = fs.readFileSync(path.join(__dirname, '../packages/account/campus-change/campus-change.js'), 'utf8')
  for (const status of ['approved', 'pending', 'failure', 'review']) {
    let definition, saved = null, cleared = [], modal, redirect
    const user = { campus: 'shipai', name: '测试', building: '', room: '', address: '', riderApproved: true }
    const store = { getUser: () => ({ campus: 'nanhai', building: '1栋' }), setUser(value) { saved = value }, saveOrders(value) { assert.equal(value.length, 0) } }
    vm.runInNewContext(source, {
      require(name) {
        if (name.endsWith('/page')) return value => { definition = value }
        if (name.endsWith('/store')) return store
        if (name.endsWith('/constants')) return require('../config/constants')
        if (name.endsWith('/order-api')) return {
          submitCampusChange: () => status === 'failure' ? Promise.reject(new Error('未完成订单')) : Promise.resolve({ status: status === 'review' ? 'approved' : status, toCampus: 'shipai', user })
        }
        throw new Error(name)
      },
      wx: { showToast() {}, removeStorageSync(key) { cleared.push(key) }, showModal(value) { modal = value }, redirectTo(value) { redirect = value.url } }
    })
    const page = { ...definition, data: { ...definition.data, reviewMode: status === 'review', reason: '搬校区' }, setData(patch) { Object.assign(this.data, patch) } }
    await page.submit()
    assert.equal(page.data.submitting, false)
    if (status === 'approved') {
      assert.equal(saved.campus, 'shipai')
      assert.equal(saved.building, '')
      assert.equal(cleared.length, 2)
      assert.equal(modal.title, '校区已变更')
      modal.success()
      assert.equal(redirect, ROUTES.editProfile)
    } else {
      assert.equal(saved, null)
      if (status !== 'failure') assert.equal(modal.content, '管理员审核通过后校区才会变更。')
    }
  }
}

async function testResolvedClaims() {
  for (const from of CAMPUSES) for (const to of CAMPUSES.filter(campus => campus !== from)) {
    for (const asRider of [false, true]) for (const statuses of [[], ['open'], ['processing'], ['resolved'], ['resolved','resolved'], ['resolved','open'], ['resolved','processing']]) {
      const {db,connection,statements} = fixture(from, true)
      const order = {id:'CLAIM-ORDER',user_id:asRider?99:1,rider_id:asRider?2:99,status:'disputed',rider_income:8,settled_at:null,withhold_rider_income:0}
      db.orders.push(order)
      db.afterSales = statuses.map((status,index)=>({id:index+1,order_id:order.id,status}))
      const history = JSON.stringify({orders:db.orders,claims:db.afterSales})
      const closed = statuses.length > 0 && statuses.every(status=>status === 'resolved')
      if (closed) {
        await autoChangeCampus(connection,1,to,'测试已结案售后',from)
        assert.equal(db.users[0].campus,to)
        assert.equal(db.riders[0].campus,to)
        assert.equal(db.riders[0].available_balance,8)
      } else await assert.rejects(autoChangeCampus(connection,1,to,'未结案售后',from),error=>error.code === (asRider?'CAMPUS_CHANGE_HAS_RIDER_TASKS':'CAMPUS_CHANGE_HAS_OPEN_ORDERS'))
      assert.equal(JSON.stringify({orders:db.orders,claims:db.afterSales}),history,'Transfer must never change disputed orders, compensation or settlement')
      assert(!statements.some(sql=>/^(INSERT|UPDATE) (orders|after_sales)/.test(sql)))
    }
    const {db,connection} = fixture(from)
    db.orders.push({id:'CLOSED',user_id:1,status:'disputed'},{id:'ACTIVE',user_id:1,status:'waiting'})
    db.afterSales.push({order_id:'CLOSED',status:'resolved'})
    await assert.rejects(autoChangeCampus(connection,1,to,'仍有其他未完订单',from),error=>error.code === 'CAMPUS_CHANGE_HAS_OPEN_ORDERS')
  }
}

async function testProfilePicker() {
  const source = fs.readFileSync(path.join(__dirname,'../packages/account/edit-profile/edit-profile.js'),'utf8')
  const constants = require('../config/constants')
  for (const campus of CAMPUSES) for (const reviewMode of [false,true]) for (const hasBuilding of [false,true]) {
    const buildings = constants.getDormBuildings(campus)
    const user = {name:'测试用户',phone:'13800000000',campus,building:hasBuilding?buildings.at(-1):'',room:'101'}
    const saved=[],toasts=[]
    let definition
    vm.runInNewContext(source,{
      require(name) {
        if(name.endsWith('/page')) return value=>definition=value
        if(name.endsWith('/store')) return {getUser:()=>user,setUser(){}}
        if(name.endsWith('/mini-auth')) return {updateProfile:async value=>{saved.push(value);return value}}
        if(name.endsWith('/constants')) return constants
        if(name.endsWith('/validators')) return require('../utils/validators')
        throw new Error(name)
      },wx:{showToast(value){toasts.push(value.title)}}
    })
    const page={...definition,data:{...definition.data,reviewMode},$setTimeout(){},setData(patch){for(const [key,value] of Object.entries(patch)){if(key==='user.building')this.data.user={...this.data.user,building:value};else this.data[key]=value}}}
    page.onLoad()
    assert.equal(page.data.buildingSelected,hasBuilding)
    assert.equal(page.data.normalBuildingIndex,hasBuilding?buildings.length:0)
    assert.equal(page.data.normalBuildingLabels[0],'请选择宿舍楼')
    if(!hasBuilding){page.save();assert.equal(saved.length,0);assert.equal(toasts.at(-1),'请选择宿舍楼')}
    for(const index of [0,buildings.length-1]){
      page.chooseBuilding({detail:{value:reviewMode?index:index+1}})
      assert.equal(page.form.building,buildings[index])
      assert.equal(page.data.buildingLabels[page.data.buildingIndex],constants.getDormBuildingLabels(campus)[index])
    }
    page.save()
    await new Promise(resolve=>setImmediate(resolve))
    assert.equal(saved.length,1)
    assert.equal(saved[0].building,buildings.at(-1))
    if(!reviewMode){page.chooseBuilding({detail:{value:0}});assert.equal(page.form.building,'');assert.equal(page.data.buildingSelected,false)}
  }
}

async function testStaleRoutes() {
  const routes = new Map()
  const noop = (request, response, next) => next()
  const { db, connection, statements } = fixture('gqg', true)
  connection.query = async () => [[{ service_status: 'open', service_notice: '' }]]
  const execute = connection.execute
  connection.execute = async (sql, values) => {
    if (sql.includes('FROM platform_settings')) return [[{ service_status: 'open', service_notice: '' }]]
    if (sql.includes('FROM users u')) return [[db.users[0]]]
    return execute(sql, values)
  }
  const router = {}
  for (const method of ['get', 'post', 'put']) router[method] = (route, ...handlers) => routes.set(method + ':' + route, handlers.at(-1))
  const root = path.resolve(__dirname, '../server/src')
  const actual = new Set(['http', 'validation', 'campus-change', 'rider-level', 'item-pricing', 'business-rules', 'campus-config', 'order-privacy'])
  class TestDate extends Date { static now() { return Date.parse('2026-10-17T04:00:00Z') } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'routes/mini.js'), 'utf8'), {
    module: { exports: {} }, Date: TestDate, console,
    require(name) {
      if (name === 'express') return { Router: () => router }
      if (name === 'crypto') return require('crypto')
      if (name === 'express-rate-limit') return () => noop
      if (name === '../db') return { pool: connection, transaction: handler => handler(connection) }
      if (name === '../idempotency') return { requireMiniIdempotency: noop, sendIdempotent: () => {} }
      if (name === '../mini-auth') return { authenticateMini: noop, verifyToken: () => ({ sub: 'test-identity' }) }
      if (actual.has(name.replace('../', ''))) return require(path.resolve(root, name.replace('../', '')))
      return {}
    }
  }, { filename: 'mini-route-test.js' })
  const invoke = (route, body = {}) => new Promise((resolve, reject) => {
    const response = { status() { return this }, json: resolve }
    routes.get(route)({ miniUser: { id: 1, campus: 'nanhai', phone: '13800000000' }, params: { id: 'TESTORDER' }, body }, response, reject)
  })
  await assert.rejects(invoke('post:/orders', { urgency: 'today', scope: 'campus', pieces: 1, uploadIds: ['0123456789abcdef'] }), error => error.code === 'CAMPUS_CHANGED')
  await assert.rejects(invoke('post:/rider/orders/:id/accept'), error => error.code === 'CAMPUS_CHANGED')
  await assert.rejects(invoke('put:/me'), error => error.code === 'CAMPUS_CHANGED')
  await assert.rejects(invoke('post:/rider/applications', { studentId: 'TEST', rulesVersion: 'test', realName: '测试', gender: 'male' }), error => error.code === 'CAMPUS_CHANGED')
  await assert.rejects(invoke('post:/auth/register', {
    registrationToken: 'test-registration-token', campus: 'nanhai', name: '测试', phone: '13800000000', building: '1', room: '101'
  }), error => error.code === 'CAMPUS_CHANGE_REQUIRED')
  assert(!statements.some(sql => /^(INSERT|UPDATE)/.test(sql)), 'Requests authenticated before a campus change cannot write stale orders or profiles')
}

async function main() {
  await testEligibility()
  await testClient()
  await testResolvedClaims()
  await testProfilePicker()
  await testStaleRoutes()
  console.log('Campus change checks passed: six directions, user/rider unfinished and resolved claims, preserved accounting, profile picker, synced profiles and old clients.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
