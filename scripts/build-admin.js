const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const aliases = { development:'dev', test:'test', production:'prod' }
const environment = process.argv[2] || 'development'
const alias = aliases[environment]
if (!alias) throw new Error(`Unsupported admin environment: ${environment}`)

const root = path.resolve(__dirname, '..')
const sourceRoot = path.join(root, 'admin-web')
const distRoot = path.join(root, 'dist', 'admin-web')
const outputRoot = path.join(distRoot, environment)
if (!outputRoot.startsWith(`${distRoot}${path.sep}`)) throw new Error('Unsafe admin build target')

const validation = spawnSync(process.execPath, [path.join(__dirname, 'validate-admin.js')], { stdio:'inherit' })
if (validation.status !== 0) process.exit(validation.status || 1)

const config = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'config', `env.${alias}.json`), 'utf8').replace(/^\uFEFF/, ''))
const packageInfo = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'package.json'), 'utf8'))
if (environment === 'production' && (/example\.edu|REPLACE/.test(config.apiBaseUrl || '') || config.enableMock !== false)) {
  throw new Error('Production admin API domain is still a placeholder or mock mode is enabled.')
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive:true })
  for (const entry of fs.readdirSync(source, { withFileTypes:true })) {
    if (entry.name === 'config' || entry.name === 'README.md' || entry.name === 'runtime-config.js') continue
    if (environment === 'production' && entry.name === 'mock.js' && path.basename(source) === 'src') continue
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else fs.copyFileSync(from, to)
  }
}

fs.rmSync(outputRoot, { recursive:true, force:true })
copyDirectory(sourceRoot, outputRoot)
const runtimeConfig = Object.assign({}, config, { version:packageInfo.version })
fs.writeFileSync(
  path.join(outputRoot, 'runtime-config.js'),
  `window.__ADMIN_CONFIG__ = Object.freeze(${JSON.stringify(runtimeConfig, null, 2)})\n`,
  'utf8'
)
console.log(`Admin web build completed: ${path.relative(root, outputRoot)}`)
