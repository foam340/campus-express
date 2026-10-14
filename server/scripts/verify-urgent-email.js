// 该命令只在当前子进程临时启用配置解析，不改变服务器 .env 中的功能开关。
process.env.URGENT_EMAIL_ENABLED = 'true'

const { verifyUrgentEmailTransport } = require('../src/urgent-email')

async function run() {
  await verifyUrgentEmailTransport()
  console.log('Urgent-order SMTP connection and authentication verified.')
}

run().catch(error => {
  const message = String(error && error.message || '')
  const configKey = message.match(/^(URGENT_EMAIL_ENABLED|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASS|SMTP_FROM|URGENT_EMAIL_TO)\b/)
  const code = String(configKey && configKey[1] || (message === 'URGENT_EMAIL_DISABLED' ? message : '') || error && (error.code || error.name) || 'EMAIL_VERIFY_FAILED')
    .replace(/[^a-zA-Z0-9_.:-]/g, '')
    .slice(0, 80)
  console.error(`Urgent-order SMTP verification failed: ${code || 'EMAIL_VERIFY_FAILED'}`)
  process.exit(1)
})
