const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const requiredFiles = [
  'src/app.js', 'src/config.js', 'src/db.js', 'src/http.js', 'src/auth.js', 'src/audit.js',
  'src/idempotency.js', 'src/validation.js', 'src/wechat.js', 'src/mini-auth.js', 'src/uploads.js', 'src/admin-attachments.js', 'src/business-rules.js', 'src/item-pricing.js', 'src/campus-change.js',
  'src/order-privacy.js', 'src/payment-money.js', 'src/payment-refunds.js', 'src/refund-sweep.js', 'src/rider-level.js', 'src/xorpay.js',
  'src/urgent-email.js', 'src/urgent-alert-rules.js', 'src/urgent-alert-queue.js', 'src/urgent-alert-sweep.js',
  'src/routes/auth.js', 'src/routes/admin.js', 'src/routes/mini.js', 'src/routes/payments.js',
  'scripts/create-admin.js', 'scripts/security-regression.js', 'scripts/verify-admin-attachments.js', 'scripts/verify-urgent-email.js', 'sql/schema.sql', 'sql/migrations/20260714_01_mini_auth.sql', 'sql/migrations/20260715_01_order_sync.sql', 'sql/migrations/20260715_02_order_actions.sql', 'sql/migrations/20260715_03_rider_settlement.sql',
  'sql/migrations/20260826_01_order_deadline.sql',
  'sql/migrations/20260827_01_expand_order_input_limits.sql',
  'sql/migrations/20260827_02_schema_alignment.sql',
  'sql/migrations/20260827_03_payment_refund_safety.sql',
  'sql/migrations/20260902_01_rider_experience_levels.sql',
  'sql/migrations/20260903_01_urgent_sms_alerts.sql',
  'sql/migrations/20260904_01_rider_experience_on_completion.sql',
  'sql/migrations/20260908_01_drop_legacy_settings.sql',
  'sql/migrations/20260909_01_drop_admin_wechat.sql',
  'sql/migrations/20260917_01_itemized_order_pricing.sql',
  'sql/rollbacks/20260917_01_itemized_order_pricing.sql',
  'sql/migrations/20260918_01_itemized_pricing_v2.sql',
  'sql/rollbacks/20260918_01_itemized_pricing_v2.sql',
  '.env.example', 'ecosystem.config.cjs'
]

for (const relative of requiredFiles) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`缺少后端文件：${relative}`)
}

for (const relative of requiredFiles.filter(item => /\.(js|cjs)$/.test(item))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, relative)], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${relative} 语法检查失败：\n${result.stderr}`)
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
for (const dependency of ['bcryptjs', 'cors', 'dotenv', 'express', 'express-rate-limit', 'helmet', 'jsonwebtoken', 'multer', 'mysql2', 'nodemailer', 'qrcode']) {
  if (!packageJson.dependencies || !packageJson.dependencies[dependency]) throw new Error(`缺少依赖：${dependency}`)
}
if (packageJson.dependencies.multer !== '2.2.0') throw new Error('multer 必须保持在已修复 multipart DoS 的 2.2.0 或经复核的新版本')
if (packageJson.dependencies['express-rate-limit'] !== '8.6.2') throw new Error('express-rate-limit 安全版本未锁定')
if (packageJson.dependencies.mysql2 !== '3.24.3') throw new Error('mysql2 必须保持在已修复压缩协议 DoS 的 3.24.3 或经复核的新版本')
if (packageJson.dependencies.nodemailer !== '9.1.1') throw new Error('nodemailer 版本必须经过复核并精确锁定')
for (const obsoleteDependency of ['@alicloud/dysmsapi20170525', '@alicloud/openapi-client', '@alicloud/tea-util']) {
  if (packageJson.dependencies[obsoleteDependency]) throw new Error(`已废弃的短信依赖仍然存在：${obsoleteDependency}`)
}
if (fs.existsSync(path.join(root, 'src/aliyun-sms.js'))) throw new Error('已废弃的阿里云短信发送模块仍然存在')
const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
if (JSON.stringify(packageLock).includes('@alicloud/')) throw new Error('锁文件仍包含已废弃的阿里云短信依赖')
const lockedIpAddress = packageLock.packages && packageLock.packages['node_modules/ip-address']
if (!lockedIpAddress || lockedIpAddress.version !== '10.5.0') throw new Error('ip-address 安全版本未锁定')

const schema = fs.readFileSync(path.join(root, 'sql/schema.sql'), 'utf8')
for (const table of ['users', 'admin_users', 'orders', 'order_notifications', 'order_refunds', 'riders', 'rider_experience_events', 'after_sales', 'withdrawals', 'platform_settings', 'admin_audit_logs', 'idempotency_keys']) {
  if (!new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`).test(schema)) throw new Error(`数据库表未定义：${table}`)
}
for (const riderLevelSchema of ['experience_points', 'rider_experience_started_at', 'uk_rider_experience_order_type']) {
  if (!schema.includes(riderLevelSchema)) throw new Error(`骑手等级结构缺失：${riderLevelSchema}`)
}
for (const requiredOrderSchema of ['deadline_at', 'payment_aoid', 'payment_expires_at', 'idx_orders_status_deadline', "'unpaid'"]) {
  if (!schema.includes(requiredOrderSchema)) throw new Error(`订单表缺少结构：${requiredOrderSchema}`)
}
for (const itemizedSchema of ['pricing_model', 'pricing_version', 'building_fee', 'item_details_json', 'item_pricing_version', 'item_small_campus_price', 'item_large_off_campus_price', 'item_building_9_fee', 'item_upper_floor_door_fee', 'bundle_tier0_discount', 'bundle_tier2_discount']) {
  if (!schema.includes(itemizedSchema)) throw new Error(`逐件计价结构缺失：${itemizedSchema}`)
}
if (!schema.includes('review_mode TINYINT(1)')) throw new Error('平台设置表缺少结构：review_mode')
for (const urgentAlertSchema of ['uk_order_notifications_order_type', 'idx_order_notifications_due', "'unknown'", 'processing_started_at']) {
  if (!schema.includes(urgentAlertSchema)) throw new Error(`很急订单邮件提醒结构缺失：${urgentAlertSchema}`)
}
const paymentsRoute = fs.readFileSync(path.join(root, 'src/routes/payments.js'), 'utf8')
if (!paymentsRoute.includes('orderPayableCents(order)')) throw new Error('支付签单必须从服务端订单计算金额')
if (/request\.body\s*\|\|\s*\{\}[\s\S]{0,120}\bamount\b/.test(paymentsRoute)) throw new Error('支付签单不得信任客户端金额')
if (!paymentsRoute.includes('expireSeconds:')) throw new Error('XorPay 支付单必须显式设置有效期')
const refundSweep = fs.readFileSync(path.join(root, 'src/refund-sweep.js'), 'utf8')
if (!refundSweep.includes('processPendingRefunds')) {
  throw new Error('退款重试引擎必须保留：refund-sweep 必须周期调用 processPendingRefunds')
}
if (refundSweep.includes('cancelExpiredWaitingOrder')) {
  throw new Error('20:30 无人接单自动取消已停用，refund-sweep 不得再取消过期 waiting 单')
}
const miniRoutes = fs.readFileSync(path.join(root, 'src/routes/mini.js'), 'utf8')
if (!miniRoutes.includes("cancelLockedOrder(conn, order, 'payment_timeout')")) {
  throw new Error('未支付订单过期清理必须复用事务取消流程')
}
if (!miniRoutes.includes('riderPrivateVisible(item.completed_at, item.observation_hours)')) {
  throw new Error('骑手附件访问必须执行售后观察期校验')
}
for (const riderLevelGuard of [
  'rider_experience_events',
  'o.created_at >= settings.rider_experience_started_at',
  'currentRider(connection, request.miniUser.id, true)',
  'activeCount >= progress.maxActiveOrders'
]) {
  if (!miniRoutes.includes(riderLevelGuard)) throw new Error(`骑手等级服务端保护缺失：${riderLevelGuard}`)
}
const experienceInsert = miniRoutes.match(/INSERT INTO rider_experience_events[\s\S]{0,1800}ON DUPLICATE KEY UPDATE/)
if (!experienceInsert || !experienceInsert[0].includes('o.completed_at IS NOT NULL') || experienceInsert[0].includes('o.settled_at IS NOT NULL')) {
  throw new Error('骑手经验必须在订单完成时发放，不得继续依赖收入结算时间')
}
if (!miniRoutes.includes('await awardCompletedOrderExperience(connection, orderId)')) {
  throw new Error('用户确认收货事务必须立即发放骑手经验')
}
for (const itemizedGuard of [
  "pricingModel: 'itemized_v1'",
  'MAX_ITEMIZED_ORDER_ITEMS',
  'requestedVersion !== ITEMIZED_PRICING_CURRENT_VERSION',
  'PRICING_VERSION_MISMATCH',
  'PRICE_QUOTE_CHANGED',
  'input.quotedTotal',
  'item_details_json',
  'pricing_version',
  'building_fee',
  'new Set(uploadIds).size !== uploadIds.length'
]) {
  if (!miniRoutes.includes(itemizedGuard)) throw new Error(`逐件订单服务端保护缺失：${itemizedGuard}`)
}
if (!/router\.get\('\/me'[\s\S]{0,180}await reconcileOrderLifecycle\(\)/.test(miniRoutes)) {
  throw new Error('个人资料刷新必须先对账订单生命周期与最新经验')
}
const experienceMigration = fs.readFileSync(path.join(root, 'sql/migrations/20260904_01_rider_experience_on_completion.sql'), 'utf8')
for (const guard of ["o.status = 'completed'", 'o.completed_at IS NOT NULL', 'o.created_at >= settings.rider_experience_started_at', "'order_settled'"]) {
  if (!experienceMigration.includes(guard)) throw new Error(`完成订单经验补发迁移缺少保护：${guard}`)
}
if (experienceMigration.includes('o.settled_at IS NOT NULL')) throw new Error('完成订单经验补发不得依赖收入结算时间')
if (!miniRoutes.includes('await queueUrgentOrderAlert(connection, orderId)') || !miniRoutes.includes('await queueNewOrderRiderEmail(connection, orderId)') || !miniRoutes.includes('skipUrgentOrderAlert(connection, orderId') || !miniRoutes.includes('skipNewOrderRiderEmail(connection, orderId')) {
  throw new Error('0元免支付订单必须启动邮件计时，骑手接单时必须同步跳过邮件提醒任务')
}
if (!paymentsRoute.includes('queueUrgentOrderAlert(connection, order_id)') || !paymentsRoute.includes('queueNewOrderRiderEmail(connection, order_id)')) {
  throw new Error('支付成功进入等待状态时必须创建邮件提醒任务')
}
const urgentAlertRules = fs.readFileSync(path.join(root, 'src/urgent-alert-rules.js'), 'utf8')
const urgentAlertQueue = fs.readFileSync(path.join(root, 'src/urgent-alert-queue.js'), 'utf8')
const urgentAlertSweep = fs.readFileSync(path.join(root, 'src/urgent-alert-sweep.js'), 'utf8')
const urgentEmail = fs.readFileSync(path.join(root, 'src/urgent-email.js'), 'utf8')
const urgentEmailVerify = fs.readFileSync(path.join(root, 'scripts/verify-urgent-email.js'), 'utf8')
if (!urgentAlertRules.includes('10 * 60 * 1000') || !urgentAlertRules.includes('URGENT_ALERT_DELAY_MINUTES = 30')) {
  throw new Error('很急订单提醒必须等待30分钟，并每10分钟扫描一次')
}
if ((urgentAlertQueue.match(/if \(!config\.urgentEmail\.enabled\) return false/g) || []).length < 2 || !urgentAlertQueue.includes("settings.review_mode = 0") || !urgentAlertQueue.includes("o.urgency = 'urgent'") || !urgentAlertQueue.includes("o.status = 'waiting'") || !urgentAlertQueue.includes('o.paid_amount > 0 OR o.original_price - o.coupon_discount <= 0')) {
  throw new Error('邮件任务入队必须排除审核模式，并限定已完成支付环节的很急待接单订单')
}
if (!urgentAlertSweep.includes("status = 'unknown'") || !urgentAlertSweep.includes('不自动重试')) {
  throw new Error('邮件未知结果必须禁止盲目重试')
}
for (const mailGuard of ['requireTLS: !config.secure', "minVersion: 'TLSv1.2'", 'rejectUnauthorized: true', 'disableFileAccess: true', 'disableUrlAccess: true', 'classifySmtpFailure(error)']) {
  if (!urgentEmail.includes(mailGuard)) throw new Error(`运营邮件安全配置缺失：${mailGuard}`)
}
if (!urgentEmail.includes("String(orderId || '').slice(-8)") || urgentEmail.includes("String(orderId).slice(0, 32)")) {
  throw new Error('运营邮件头只能记录订单号后8位')
}
if (!urgentEmailVerify.includes("process.env.URGENT_EMAIL_ENABLED = 'true'")) {
  throw new Error('SMTP 验证命令必须能在正式开关关闭时独立校验配置')
}
const adminRoutes = fs.readFileSync(path.join(root, 'src/routes/admin.js'), 'utf8')
if (!adminRoutes.includes('MANUAL_PAYMENT_DISABLED')) throw new Error('管理台线下确认收款接口必须保持停用')
if (!adminRoutes.includes('view_order_attachment') || !adminRoutes.includes('download_order_attachment')) {
  throw new Error('管理员查看或下载订单凭证必须写入审计日志')
}
for (const adminPricingGuard of ['itemSmallCampusPrice', 'bundleTier2Discount', 'READ_ONLY_PRICING_FIELDS', 'PRICE_SETTINGS_READ_ONLY']) {
  if (!adminRoutes.includes(adminPricingGuard)) throw new Error(`管理台逐件计价配置缺失：${adminPricingGuard}`)
}
for (const settingsSplitGuard of ["router.put('/settings/operational'", "router.put('/settings/service-status'"]) {
  if (!adminRoutes.includes(settingsSplitGuard)) throw new Error(`管理台设置接口拆分缺失：${settingsSplitGuard}`)
}
if (!adminRoutes.includes("router.get('/settings', requireRoles('admin', 'auditor')")) {
  throw new Error('管理台 GET /settings 角色契约必须为 admin|auditor')
}
if (adminRoutes.includes("router.get('/settings', requireRoles('operator'")) {
  throw new Error('管理台 GET /settings 不得再对 operator 开放')
}
if (!adminRoutes.includes('readSettings(connection)')) {
  throw new Error('管理台设置写接口保存后必须回读 readSettings(connection)')
}
const exampleEnv = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
const allowedPlaceholders = new Set([
  'REPLACE_WITH_DATABASE_PASSWORD',
  'REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS',
  'REPLACE_WITH_WECHAT_APP_ID',
  'REPLACE_WITH_WECHAT_APP_SECRET',
  'REPLACE_WITH_XORPAY_AID',
  'REPLACE_WITH_XORPAY_SECRET',
  'REPLACE_WITH_SMTP_HOST',
  'REPLACE_WITH_SMTP_USER',
  'REPLACE_WITH_SMTP_AUTH_SECRET',
  'REPLACE_WITH_SMTP_FROM_EMAIL',
  'REPLACE_WITH_ALERT_EMAIL'
])
for (const placeholder of exampleEnv.match(/REPLACE_WITH_[A-Z0-9_]+/g) || []) {
  if (!allowedPlaceholders.has(placeholder)) throw new Error(`.env.example 包含未知占位符：${placeholder}`)
}
for (const [key, placeholder] of [
  ['SMTP_HOST', 'REPLACE_WITH_SMTP_HOST'],
  ['SMTP_USER', 'REPLACE_WITH_SMTP_USER'],
  ['SMTP_PASS', 'REPLACE_WITH_SMTP_AUTH_SECRET'],
  ['SMTP_FROM', 'REPLACE_WITH_SMTP_FROM_EMAIL'],
  ['URGENT_EMAIL_TO', 'REPLACE_WITH_ALERT_EMAIL']
]) {
  if (!exampleEnv.includes(`${key}=${placeholder}`)) throw new Error(`.env.example 的 ${key} 必须保持为指定占位符`)
}
if (fs.existsSync(path.join(root, '.env')) && process.env.ALLOW_PRODUCTION_ENV_FILE !== 'true') {
  throw new Error('代码目录中不应打包真实 .env 文件；生产服务器自检需显式设置 ALLOW_PRODUCTION_ENV_FILE=true')
}
if (!exampleEnv.includes('UPLOAD_DIR=/www/services/campus-express-api/uploads')) throw new Error('.env.example 的生产上传目录必须与现网真身一致')
if (/^URGENT_EMAIL_TO=(?!REPLACE_WITH_)[^\r\n]+@/m.test(exampleEnv)) throw new Error('.env.example 不得写入真实提醒邮箱')
for (const obsoleteKey of ['URGENT_SMS_', 'ALIBABA_CLOUD_', 'ALIYUN_SMS_']) {
  if (exampleEnv.includes(obsoleteKey)) throw new Error(`.env.example 仍包含已废弃的短信配置：${obsoleteKey}`)
}

const securityRegression = spawnSync(process.execPath, [path.join(root, 'scripts/security-regression.js')], { encoding: 'utf8' })
if (securityRegression.status !== 0) {
  throw new Error(`上传与限流安全回归失败：\n${securityRegression.stderr || securityRegression.stdout}`)
}

console.log(`Backend validation passed: ${requiredFiles.length} required files and ${Object.keys(packageJson.dependencies).length} runtime dependencies.`)
