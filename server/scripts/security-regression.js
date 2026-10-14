const assert = require('assert')
const express = require('express')
const http = require('http')
const multer = require('multer')
const rateLimit = require('express-rate-limit')
const path = require('path')
const { attachmentDownloadName, resolveAttachmentPath } = require('../src/admin-attachments')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise(resolve => server.close(() => resolve()))
}

function uploadForm(size, extraField = false) {
  const form = new FormData()
  form.append('file', new Blob([Buffer.alloc(size)], { type: 'image/png' }), 'test.png')
  if (extraField) form.append('unexpected', 'blocked')
  return form
}

async function main() {
  const uploadRoot = path.resolve(__dirname, '..', 'uploads')
  assert.strictEqual(
    resolveAttachmentPath(uploadRoot, path.join(uploadRoot, '1', 'pickup', 'abc.jpg'), 'image/jpeg'),
    path.join(uploadRoot, '1', 'pickup', 'abc.jpg')
  )
  assert.throws(
    () => resolveAttachmentPath(uploadRoot, path.resolve(uploadRoot, '..', 'secret.jpg'), 'image/jpeg'),
    error => error && error.code === 'ADMIN_ATTACHMENT_NOT_FOUND'
  )
  assert.throws(
    () => resolveAttachmentPath(uploadRoot, path.join(uploadRoot, '1', 'pickup', 'abc.jpg'), 'text/html'),
    error => error && error.code === 'ADMIN_ATTACHMENT_MIME_UNSUPPORTED'
  )
  assert.strictEqual(
    attachmentDownloadName('KD202608310001', 'pickup', 'aabbccddeeff0011', 'image/png'),
    'KD202608310001-pickup-aabbccddeeff.png'
  )

  const app = express()
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fields: 0, parts: 2, fieldNameSize: 32, fileSize: 1024 }
  })
  app.post('/upload', upload.single('file'), (request, response) => {
    response.json({ size: request.file && request.file.size })
  })
  app.get('/limited', rateLimit({
    windowMs: 60 * 1000,
    limit: 2,
    standardHeaders: false,
    legacyHeaders: false
  }), (request, response) => response.send('ok'))
  app.use((error, request, response, next) => {
    const limited = error instanceof multer.MulterError
    response.status(limited ? 413 : 500).json({ code: limited ? error.code : 'UNKNOWN' })
  })

  const server = http.createServer(app)
  try {
    const port = await listen(server)
    const baseUrl = `http://127.0.0.1:${port}`

    const valid = await fetch(`${baseUrl}/upload`, { method: 'POST', body: uploadForm(32) })
    assert.strictEqual(valid.status, 200)
    assert.deepStrictEqual(await valid.json(), { size: 32 })

    const oversized = await fetch(`${baseUrl}/upload`, { method: 'POST', body: uploadForm(2048) })
    assert.strictEqual(oversized.status, 413)
    assert.strictEqual((await oversized.json()).code, 'LIMIT_FILE_SIZE')

    const extraField = await fetch(`${baseUrl}/upload`, { method: 'POST', body: uploadForm(32, true) })
    assert.strictEqual(extraField.status, 413)
    assert.ok(['LIMIT_FIELD_COUNT', 'LIMIT_PART_COUNT'].includes((await extraField.json()).code))

    const limitedStatuses = []
    for (let index = 0; index < 3; index += 1) {
      limitedStatuses.push((await fetch(`${baseUrl}/limited`)).status)
    }
    assert.deepStrictEqual(limitedStatuses, [200, 200, 429])
  } finally {
    await close(server)
  }
  console.log('Security regression passed: attachment paths, multipart limits and request rate limiting.')
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error))
  process.exit(1)
})
