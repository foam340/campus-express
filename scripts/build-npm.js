const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const npmRoot = path.join(root, 'node_modules', 'miniprogram-recycle-view', 'miniprogram_dist')
const outputRoot = path.join(root, 'miniprogram_npm')
const output = path.join(outputRoot, 'miniprogram-recycle-view')

function assertSafeOutput(target) {
  const resolved = path.resolve(target)
  if (!resolved.startsWith(`${path.resolve(outputRoot)}${path.sep}`)) {
    throw new Error(`Unsafe npm build output: ${resolved}`)
  }
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyDirectory(from, to)
    else fs.copyFileSync(from, to)
  }
}

if (!fs.existsSync(npmRoot)) {
  throw new Error('Missing miniprogram-recycle-view. Run npm ci before building.')
}

assertSafeOutput(output)
fs.rmSync(output, { recursive: true, force: true })
copyDirectory(npmRoot, output)

console.log(`Mini Program npm built: ${path.relative(root, output)}`)
