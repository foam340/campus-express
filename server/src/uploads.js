const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const multer = require('multer')
const config = require('./config')
const { HttpError } = require('./http')
const { THUMB_SUFFIX } = require('./thumbnail')

const mimeExtensions = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
})

const upload = multer({
  storage: multer.memoryStorage(),
  // 上传接口只接受一个名为 file 的文件，不接受额外表单字段。
  // 限制 parts/fields/字段名长度，进一步压缩恶意 multipart 请求的资源消耗面。
  limits: {
    files: 1,
    fields: 0,
    // Busboy 在达到 parts 阈值时即发出限制事件，因此设为 2 才允许唯一的文件 part。
    parts: 2,
    fieldNameSize: 32,
    fileSize: config.uploadMaxFileBytes
  },
  fileFilter(request, file, callback) {
    callback(null, Object.prototype.hasOwnProperty.call(mimeExtensions, String(file.mimetype || '').toLowerCase()))
  }
})

function uploadMiddleware(request, response, next) {
  upload.single('file')(request, response, error => {
    if (!error) return next()
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new HttpError(413, '图片不能超过5MB', 'UPLOAD_TOO_LARGE'))
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(new HttpError(400, '仅支持 JPG、PNG 或 WebP 图片', 'INVALID_UPLOAD_FILE'))
      }
      return next(new HttpError(400, error.message || '上传失败', 'UPLOAD_ERROR'))
    }
    // 非 Multer 错误原样传递，避免掩盖真实错误
    return next(error)
  })
}

async function persistUpload(file, userId, kind) {
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw new HttpError(400, '请上传图片', 'UPLOAD_FILE_REQUIRED')
  }
  const mime = String(file.mimetype || '').toLowerCase()
  const extension = mimeExtensions[mime]
  if (!extension) throw new HttpError(400, '图片格式不支持', 'INVALID_UPLOAD_FILE')
  const id = crypto.randomUUID().replace(/-/g, '')
  const directory = path.join(config.uploadDir, String(userId), kind)
  const absolutePath = path.join(directory, `${id}${extension}`)
  await fs.mkdir(directory, { recursive: true, mode: 0o750 })
  await fs.writeFile(absolutePath, file.buffer, { mode: 0o640 })
  return { id, absolutePath, mime, size: file.size }
}

async function deleteUpload(absolutePath) {
  if (!absolutePath) return
  try { await fs.unlink(absolutePath) } catch (error) { if (error.code !== 'ENOENT') throw error }
  // 一并清理缩略图，避免原图删了却留下孤儿 .thumb.jpg
  try { await fs.unlink(`${absolutePath}${THUMB_SUFFIX}`) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

module.exports = { uploadMiddleware, persistUpload, deleteUpload }
