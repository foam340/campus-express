const assert = require('assert')
const config = require('../src/config')
const { issueAdminToken, parseRoles } = require('../src/auth')
const { pool } = require('../src/db')

const baseUrl = String(process.env.ADMIN_ATTACHMENT_VERIFY_BASE_URL || `http://127.0.0.1:${config.port}`).replace(/\/$/, '')

async function request(route, token) {
  const headers = { Accept:'application/json', 'X-Request-Id':`attachment-verify-${Date.now()}` }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${baseUrl}${route}`, { headers, cache:'no-store' })
  const body = await response.json().catch(() => null)
  return { response, body }
}

async function main() {
  const [admins] = await pool.execute(
    "SELECT id, display_name, roles_json FROM admin_users WHERE status = 'active' ORDER BY created_at ASC LIMIT 100"
  )
  const admin = admins
    .map(item => ({ id:String(item.id), name:item.display_name, roles:parseRoles(item.roles_json) }))
    .find(item => item.roles.includes('super_admin') || item.roles.some(role => ['operator','customer_service','auditor'].includes(role)))
  assert.ok(admin, '没有可验证订单凭证权限的管理员账号')
  const token = issueAdminToken(admin)

  let result = await request('/admin/orders?page=1&pageSize=100', token)
  assert.strictEqual(result.response.status, 200, `订单列表验证失败：${result.response.status}`)
  const orders = result.body && result.body.data && Array.isArray(result.body.data.items) ? result.body.data.items : []
  const order = orders.find(item => Number(item.attachmentCount) > 0)
  let metadataCount = 0
  if (order) {
    result = await request(`/admin/orders/${encodeURIComponent(order.id)}/attachments`, token)
    assert.strictEqual(result.response.status, 200, `凭证列表验证失败：${result.response.status}`)
    const items = result.body && result.body.data && Array.isArray(result.body.data.items) ? result.body.data.items : []
    metadataCount = items.length
    assert.ok(items.length > 0, '订单显示有凭证，但凭证列表为空')
    for (const item of items) {
      assert.ok(!Object.prototype.hasOwnProperty.call(item, 'storagePath'), '接口不得返回服务器存储路径')
      assert.ok(!Object.prototype.hasOwnProperty.call(item, 'storage_path'), '接口不得返回数据库存储路径')
    }
    result = await request(`/admin/orders/${encodeURIComponent(order.id)}/attachments/${'0'.repeat(32)}`, token)
    assert.strictEqual(result.response.status, 404, '不存在的凭证必须返回404')
  }

  result = await request('/admin/orders/VERIFY000/attachments', '')
  assert.strictEqual(result.response.status, 401, '未登录访问凭证接口必须返回401')
  console.log(JSON.stringify({ ok:true, orders:orders.length, ordersWithAttachments:orders.filter(item => Number(item.attachmentCount) > 0).length, metadataCount }))
}

main()
  .catch(error => {
    console.error(error && error.stack ? error.stack : String(error))
    process.exitCode = 1
  })
  .finally(() => pool.end())
