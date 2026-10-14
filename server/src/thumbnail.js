const fs = require('fs/promises')
const sharp = require('sharp')

// 缩略图以「原图路径 + .thumb.jpg」存放在原图同目录，与原图同生共死（见 uploads.deleteUpload 一并清理）。
const THUMB_SUFFIX = '.thumb.jpg'
const THUMB_MAX_DIMENSION = 1280
const THUMB_QUALITY = 80

// 生成（或命中磁盘缓存）缩略图，返回缩略图绝对路径。
// 原图可能是几 MB 的相机照片，而详情页只显示 ~100px 宽；缩到 1280px JPEG 能快好几倍。
// 生成失败会向上抛错，由调用方退回原图，绝不让图片直接消失。
async function ensureThumbnail(storagePath) {
  if (!storagePath) throw new Error('THUMBNAIL_NO_PATH')
  const thumbPath = `${storagePath}${THUMB_SUFFIX}`
  try {
    await fs.access(thumbPath)
    return thumbPath
  } catch (_) { /* 尚未生成，下面生成 */ }
  await sharp(storagePath)
    .rotate() // 按 EXIF 方向摆正
    .resize(THUMB_MAX_DIMENSION, THUMB_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }) // 透明 PNG 转 JPEG 垫白底，避免透明区变黑
    .jpeg({ quality: THUMB_QUALITY, progressive: true })
    .toFile(thumbPath)
  return thumbPath
}

module.exports = { ensureThumbnail, THUMB_SUFFIX }
