const fs = require('fs')
const http = require('http')
const path = require('path')

const root = path.resolve(__dirname, '..')
const requested = process.argv[2] || 'dist/admin-web/development'
const port = Math.max(1024, Math.min(65535, Number(process.argv[3]) || 4173))
const publicRoot = path.resolve(root, requested)
if (!publicRoot.startsWith(`${root}${path.sep}`) || !fs.existsSync(publicRoot)) {
  throw new Error(`Admin build directory does not exist: ${requested}`)
}
const mimeTypes = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.webp':'image/webp'
}

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = path.resolve(publicRoot, relative)
  if (!file.startsWith(`${publicRoot}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' })
    response.end('Not Found')
    return
  }
  response.writeHead(200, {
    'Content-Type':mimeTypes[path.extname(file)] || 'application/octet-stream',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  })
  fs.createReadStream(file).pipe(response)
}).listen(port, '127.0.0.1', () => {
  console.log(`Admin web is running at http://127.0.0.1:${port}`)
  console.log('Press Ctrl+C to stop.')
})
