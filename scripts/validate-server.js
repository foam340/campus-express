const path = require('path')
const { spawnSync } = require('child_process')

const script = path.resolve(__dirname, '..', 'server', 'scripts', 'check.js')
const result = spawnSync(process.execPath, [script], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
