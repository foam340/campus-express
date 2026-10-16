const assert = require('node:assert/strict')

async function run() {
  const savedGlobals = new Map(['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const storage = new Map()
  Object.defineProperty(globalThis, 'window', { configurable:true, value:{ setTimeout:callback => { callback(); return 0 } } })
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{ getItem:key => storage.get(key) || null, setItem:(key, value) => storage.set(key, String(value)) } })
  try {
    const { handleMockRequest } = await import('../admin-web/src/mock.js')
    const request = (url, method = 'GET') => handleMockRequest({ url, method, headers:{ Authorization:'Bearer mock-admin-token' }, data:{} })
    const list = () => request('/admin/orders?pageSize=100')
    const withhold = id => request(`/admin/orders/${encodeURIComponent(id)}/withhold-rider-income`, 'POST')
    const initial = await list()
    const find = (items, id) => items.find(item => item.id === id)
    const eligibleId = 'KD20260714000018'
    const eligible = find(initial.items, eligibleId)
    assert.equal(eligible.riderPayoutPending, true)
    assert.equal(eligible.withholdRiderIncome, false)
    assert.equal(eligible.riderId, 'R1001')
    assert.equal(eligible.riderIncome, eligible.originalPrice)
    assert.equal(find(initial.items, 'KD20260713000013').withholdRiderIncome, true)
    for (const id of ['KD20260714000017', 'KD20260713000012', 'KD20260713000014', 'KD20260712000011']) {
      assert.equal(find(initial.items, id).riderPayoutPending, false)
    }
    await assert.rejects(() => withhold('KD-NOT-EXIST'), /订单不存在/)
    await assert.rejects(() => withhold('KD20260714000017'), /尚无骑手/)
    await assert.rejects(() => withhold('KD20260713000014'), /已冻结/)
    await assert.rejects(() => withhold('KD20260712000011'), /已结算/)
    const ridersBefore = await request('/admin/riders/overview')
    assert.deepEqual(await withhold(eligibleId), { id:eligibleId, withholdRiderIncome:true })
    const updated = find((await list()).items, eligibleId)
    assert.equal(updated.withholdRiderIncome, true)
    for (const field of ['status', 'riderId', 'riderIncome', 'originalPrice', 'paidAmount']) {
      assert.equal(updated[field], eligible[field])
    }
    assert.deepEqual(await request('/admin/riders/overview'), ridersBefore)
    await assert.rejects(() => withhold(eligibleId), /已标记/)
    const state = JSON.parse(storage.get('campus_admin_mock_v5'))
    assert.equal(state.auditLogs.length, 1)
    assert.match(state.auditLogs[0].detail, new RegExp(eligibleId))

    // 已经在浏览器中保存过的旧格式也应显示按钮，不要求开发人员清空 localStorage。
    const oldOrder = { id:eligibleId, contactName:'缓存用户', riderName:'张同学', status:'delivering', originalPrice:8, paidAmount:6 }
    storage.set('campus_admin_mock_v5', JSON.stringify({ orders:[oldOrder] }))
    const migrated = (await list()).items[0]
    assert.equal(migrated.riderPayoutPending, true)
    assert.equal(migrated.withholdRiderIncome, false)
    assert.equal(migrated.contactName, oldOrder.contactName)
    assert.equal(migrated.paidAmount, oldOrder.paidAmount)
    await withhold(eligibleId)
    assert.equal((await list()).items[0].withholdRiderIncome, true)
    const persisted = JSON.parse(storage.get('campus_admin_mock_v5'))
    persisted.orders[0].withholdRiderIncome = false
    persisted.orders[0].status = 'cancelled'
    storage.set('campus_admin_mock_v5', JSON.stringify(persisted))
    assert.equal((await list()).items[0].riderPayoutPending, false)
    console.log('Admin Mock checks passed: payout eligibility, withheld/frozen/settled demos, guards, persistence, audit and legacy cache migration.')
  } finally {
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
