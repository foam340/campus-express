/**
 * 清空所有业务数据，保留 admin_users 和 platform_settings。
 * 内测前重置。
 * 用法: node scripts/reset-data.js
 */
const { pool } = require('../src/db')

async function reset() {
  console.log('准备清空业务数据…')

  // 禁用外键检查，避免删表顺序问题
  await pool.execute('SET FOREIGN_KEY_CHECKS = 0')

  const tables = [
    'after_sales',
    'campus_change_requests',
    'ledger_entries',
    'rider_experience_events',
    'order_notifications',
    'order_attachments',
    'order_uploads',
    'orders',
    'withdrawals',
    'rider_events',
    'rider_applications',
    'riders',
    'user_coupons',
    'coupon_codes',
    'coupon_campaigns',
    'users',
    'admin_audit_logs',
    'idempotency_keys',
    'mini_idempotency_keys'
  ]

  for (const table of tables) {
    try {
      const [result] = await pool.execute(`TRUNCATE TABLE \`${table}\``)
      console.log(`  ✓ ${table}`)
    } catch (err) {
      // TRUNCATE 不行就用 DELETE（外键约束时）
      try {
        const [result] = await pool.execute(`DELETE FROM \`${table}\``)
        console.log(`  ✓ ${table} (DELETE)`)
      } catch (err2) {
        console.log(`  ✗ ${table}: ${err2.message}`)
      }
    }
  }

  await pool.execute('SET FOREIGN_KEY_CHECKS = 1')
  console.log('\n业务数据已清空。admin_users 和 platform_settings 保留。')
  process.exit(0)
}

reset().catch(err => {
  console.error('重置失败:', err.message)
  process.exit(1)
})
