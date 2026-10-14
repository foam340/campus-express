const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const adminRoot = path.join(root, 'admin-web')
const errors = []
const requiredFiles = [
  'index.html', 'styles.css', 'runtime-config.js', 'package.json', 'assets/logo.svg',
  'src/app.js', 'src/api.js', 'src/config.js', 'src/format.js', 'src/request.js', 'src/session.js', 'src/mock.js',
  'config/env.dev.json', 'config/env.test.json', 'config/env.prod.json'
]

const adminPackagePath = path.join(adminRoot, 'package.json')
if (fs.existsSync(adminPackagePath)) {
  const adminPackage = JSON.parse(fs.readFileSync(adminPackagePath, 'utf8').replace(/^\uFEFF/, ''))
  if (adminPackage.type !== 'module') errors.push('Admin web package.json must set type to module')
  if (!/^\d+\.\d+\.\d+$/.test(adminPackage.version || '')) errors.push('Admin web package.json must contain a semantic version')
}

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(adminRoot, file))) errors.push(`Missing admin web file: ${file}`)
}

for (const environment of ['dev', 'test', 'prod']) {
  const file = path.join(adminRoot, 'config', `env.${environment}.json`)
  if (!fs.existsSync(file)) continue
  const config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  if (!/^https:\/\//.test(config.apiBaseUrl || '')) errors.push(`Admin ${environment} apiBaseUrl must use HTTPS`)
  if (environment === 'prod' && config.enableMock !== false) errors.push('Production admin web must disable mock mode')
}

const html = fs.existsSync(path.join(adminRoot, 'index.html')) ? fs.readFileSync(path.join(adminRoot, 'index.html'), 'utf8') : ''
for (const id of ['loginScreen','loginForm','adminApp','navList','pageContent','logoutButton','attachmentModal','attachmentList']) {
  if (!html.includes(`id="${id}"`)) errors.push(`Admin HTML is missing #${id}`)
}

const moduleFiles = fs.existsSync(path.join(adminRoot, 'src'))
  ? fs.readdirSync(path.join(adminRoot, 'src')).filter(file => file.endsWith('.js')).map(file => path.join(adminRoot, 'src', file))
  : []
for (const file of moduleFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' })
  if (result.status !== 0) errors.push(`Admin JS syntax error in ${path.basename(file)}: ${result.stderr.trim()}`)
  const code = fs.readFileSync(file, 'utf8')
  for (const match of code.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
    const resolved = path.resolve(path.dirname(file), match[1])
    if (!fs.existsSync(resolved)) errors.push(`Missing admin module ${match[1]} imported by ${path.basename(file)}`)
  }
}

// 1A：设置页拆分为「只读价格 + 运营参数 + 服务状态」，价格不得在管理台单独修改
const mockSource = fs.readFileSync(path.join(adminRoot, 'src', 'mock.js'), 'utf8')
for (const v2Field of ['itemBuilding9Fee', 'itemUpperFloorDoorFee', 'bundleTier0Threshold', 'bundleTier0Discount', 'itemPricingVersion']) {
  if (!mockSource.includes(v2Field)) errors.push(`Admin mock.js 缺少 V2 价格字段：${v2Field}`)
}
for (const endpoint of ["'/admin/settings/operational'", "'/admin/settings/service-status'"]) {
  if (!mockSource.includes(endpoint)) errors.push(`Admin mock.js 缺少设置拆分接口 Mock：${endpoint}`)
}
const apiSource = fs.readFileSync(path.join(adminRoot, 'src', 'api.js'), 'utf8')
for (const apiMethod of ['updateOperational', 'updateServiceStatus']) {
  if (!apiSource.includes(apiMethod)) errors.push(`Admin api.js 缺少接口方法：${apiMethod}`)
}
const appSource = fs.readFileSync(path.join(adminRoot, 'src', 'app.js'), 'utf8')
if (!appSource.includes("settings:['admin','auditor']")) errors.push('Admin 设置菜单必须对 admin|auditor 开放')
for (const submitFn of ['submitOperational', 'submitServiceStatus']) {
  if (!appSource.includes(submitFn)) errors.push(`Admin app.js 缺少提交函数：${submitFn}`)
}
for (const forbiddenField of ['name="itemSmallCampusPrice"', 'name="campusPrice"', 'name="commissionRate"']) {
  if (appSource.includes(forbiddenField)) errors.push(`Admin 设置页不得再直接编辑价格字段：${forbiddenField}`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`Admin validation passed: ${moduleFiles.length} JavaScript modules, ${requiredFiles.length} required files.`)
