const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const aliases = { development:'dev', test:'test', production:'prod' }
const environment = process.argv[2] || 'development'
const alias = aliases[environment]
if (!alias) throw new Error(`Unsupported environment: ${environment}`)

const root = path.resolve(__dirname, '..')
const distRoot = path.resolve(root, 'dist')
const target = path.resolve(distRoot, environment)
if (!target.startsWith(`${distRoot}${path.sep}`)) throw new Error('Unsafe build target')
const env = require(path.join(root,'config',`env.${alias}.js`))
const productionConfig = `${env.appId}${env.apiBaseUrl}${env.uploadBaseUrl}${env.downloadBaseUrl}${env.webBaseUrl}`
if (environment === 'production' && /REPLACE|example\.edu/.test(productionConfig)) {
  throw new Error('Production AppID or service domain still contains placeholder values.')
}

const npmBuild = spawnSync(process.execPath, [path.join(__dirname,'build-npm.js')], {stdio:'inherit'})
if (npmBuild.status !== 0) process.exit(npmBuild.status || 1)

const validation = spawnSync(process.execPath, [path.join(__dirname,'validate.js')], {stdio:'inherit'})
if (validation.status !== 0) process.exit(validation.status || 1)

fs.rmSync(target, {recursive:true, force:true})
fs.mkdirSync(target, {recursive:true})
// .claude / .agents 是本地工具目录（Claude Code 的配置与 skills），不参与小程序运行，但曾被整目录复制进
// dist/production 并随包上传微信（dist/production/.claude/settings.local.json 实际存在过）。新增工具目录一律加这里。
const ignored = new Set(['dist','node_modules','.git','.vscode','.claude','.agents','.deploy-tmp','scripts','deploy','docs','admin-web','server','design-prototypes'])
const ignoredFiles = new Set(['package.json','package-lock.json','project.private.config.json','jsconfig.json','README.md','CHANGELOG.md','_reassign_order.js'])
const allowedExtensions = new Set(['.js','.json','.wxml','.wxss','.webp','.png','.jpg','.jpeg','.svg'])

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, {recursive:true})
  for (const entry of fs.readdirSync(source, {withFileTypes:true})) {
    if (ignored.has(entry.name) || ignoredFiles.has(entry.name)) continue
    const from = path.join(source,entry.name)
    const to = path.join(destination,entry.name)
    if (entry.isDirectory()) copyDirectory(from,to)
    else if (allowedExtensions.has(path.extname(entry.name)) || ['sitemap.json','project.config.json'].includes(entry.name)) fs.copyFileSync(from,to)
  }
}
copyDirectory(root,target)

fs.writeFileSync(path.join(target,'config','current.js'), `module.exports = require('./env.${alias}')\n`)
for (const candidate of ['dev','test','prod']) {
  if (candidate !== alias) fs.rmSync(path.join(target,'config',`env.${candidate}.js`), {force:true})
}
const projectPath = path.join(target,'project.config.json')
const project = JSON.parse(fs.readFileSync(projectPath,'utf8').replace(/^\uFEFF/,''))
project.appid = env.appId
project.projectname = `campus-express-${alias}`
project.setting.urlCheck = environment === 'production'
project.setting.compileHotReLoad = environment !== 'production'
fs.writeFileSync(projectPath, `${JSON.stringify(project,null,2)}\n`)
console.log(`Build completed: ${path.relative(root,target)}`)
