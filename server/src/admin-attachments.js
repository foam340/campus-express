const path = require('path')
const { HttpError } = require('./http')

const mimeExtensions = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
})

function resolveAttachmentPath(uploadDir, storagePath, mimeType) {
  const root = path.resolve(String(uploadDir || ''))
  const absolutePath = path.resolve(String(storagePath || ''))
  const extension = mimeExtensions[String(mimeType || '').toLowerCase()]
  if (!extension) throw new HttpError(415, '图片格式不支持', 'ADMIN_ATTACHMENT_MIME_UNSUPPORTED')
  if (!absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new HttpError(404, '图片不存在', 'ADMIN_ATTACHMENT_NOT_FOUND')
  }
  if (path.extname(absolutePath).toLowerCase() !== extension) {
    throw new HttpError(404, '图片不存在', 'ADMIN_ATTACHMENT_NOT_FOUND')
  }
  return absolutePath
}

function attachmentDownloadName(orderId, kind, attachmentId, mimeType) {
  const extension = mimeExtensions[String(mimeType || '').toLowerCase()] || '.bin'
  const safeOrderId = String(orderId || 'order').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'order'
  const safeKind = kind === 'delivery' ? 'delivery' : 'pickup'
  const safeAttachmentId = String(attachmentId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'attachment'
  return `${safeOrderId}-${safeKind}-${safeAttachmentId}${extension}`
}

module.exports = { attachmentDownloadName, resolveAttachmentPath }
