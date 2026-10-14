const bcrypt = require('bcryptjs')
const { pool } = require('../src/db')

function required(name, minLength = 1) {
  const value = String(process.env[name] || '').trim()
  if (value.length < minLength) throw new Error(`${name} 未设置或长度不足`)
  return value
}

async function main() {
  const username = required('BOOTSTRAP_ADMIN_USERNAME', 3)
  const displayName = required('BOOTSTRAP_ADMIN_DISPLAY_NAME', 2)
  const password = required('BOOTSTRAP_ADMIN_PASSWORD', 12)
  const forceUpdate = String(process.env.BOOTSTRAP_ADMIN_FORCE_UPDATE || 'false') === 'true'
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
    throw new Error('管理员账号只能包含字母、数字、点、下划线或短横线')
  }
  if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('管理员密码不能超过72字节')

  const [existing] = await pool.execute('SELECT id FROM admin_users WHERE username = ? LIMIT 1', [username])
  if (existing[0] && !forceUpdate) {
    throw new Error('管理员账号已存在；如需重置，请明确设置 BOOTSTRAP_ADMIN_FORCE_UPDATE=true')
  }
  const passwordHash = await bcrypt.hash(password, 12)
  if (existing[0]) {
    await pool.execute(
      `UPDATE admin_users
          SET password_hash = ?, display_name = ?, roles_json = ?, status = 'active', updated_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [passwordHash, displayName.slice(0, 80), JSON.stringify(['super_admin']), existing[0].id]
    )
    console.log(`管理员账号 ${username} 已安全更新。`)
  } else {
    await pool.execute(
      `INSERT INTO admin_users
         (username, password_hash, display_name, roles_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [username, passwordHash, displayName.slice(0, 80), JSON.stringify(['super_admin'])]
    )
    console.log(`管理员账号 ${username} 已创建。`)
  }
}

main()
  .catch(error => {
    console.error(`创建管理员失败：${error.message}`)
    process.exitCode = 1
  })
  .finally(() => pool.end())
