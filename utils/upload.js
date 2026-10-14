const config = require('../config/index')
const session = require('./session')

const MAX_UPLOAD_BYTES = 1024 * 1024 // 1MB\uff0c\u8d85\u8fc7\u6b64\u5927\u5c0f\u5148\u538b\u7f29\u518d\u4e0a\u4f20

/**
 * \u83b7\u53d6\u6587\u4ef6\u5927\u5c0f
 */
function getFileSize(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().getFileInfo({
      filePath,
      success: info => resolve(info.size),
      fail: reject
    })
  })
}

/**
 * \u538b\u7f29\u56fe\u7247\u81f3\u76ee\u6807\u4f53\u79ef\u4ee5\u5185
 */
function compressIfNeeded(filePath) {
  return getFileSize(filePath).then(size => {
    if (size <= MAX_UPLOAD_BYTES) return filePath
    // \u56fe\u7247\u8fc7\u5927\uff0c\u538b\u7f29
    return new Promise((resolve, reject) => {
      wx.compressImage({
        src: filePath,
        quality: 60,
        compressedWidth: 1600,
        success: res => resolve(res.tempFilePath),
        fail: () => resolve(filePath) // \u538b\u7f29\u5931\u8d25\u7528\u539f\u56fe
      })
    })
  })
}

function uploadImage(filePath, kind) {
  return compressIfNeeded(filePath).then(compressedPath => {
    return new Promise((resolve, reject) => {
      const token = session.getAccessToken()
      if (!token) return reject(new Error('\u8bf7\u5148\u767b\u5f55\u5c0f\u7a0b\u5e8f'))
      const target = kind === 'delivery' ? 'delivery' : 'pickup'
      wx.uploadFile({
        url: `${String(config.apiBaseUrl || '').replace(/\/$/, '')}/mini/uploads/${target}`,
        filePath: compressedPath,
        name: 'file',
        header: { Authorization: `Bearer ${token}` },
        timeout: 30000,
        success(result) {
          try {
            const payload = JSON.parse(result.data || '{}')
            if (result.statusCode >= 200 && result.statusCode < 300 && Number(payload.code) === 0 && payload.data && payload.data.uploadId) {
              resolve(payload.data.uploadId)
            } else reject(new Error(payload.message || '\u56fe\u7247\u4e0a\u4f20\u5931\u8d25'))
          } catch (error) { reject(new Error('\u56fe\u7247\u4e0a\u4f20\u54cd\u5e94\u5f02\u5e38')) }
        },
        fail(error) { reject(new Error(error && error.errMsg || '\u56fe\u7247\u4e0a\u4f20\u5931\u8d25')) }
      })
    })
  })
}

function uploadPickup(filePath) { return uploadImage(filePath, 'pickup') }
function uploadDelivery(filePath) { return uploadImage(filePath, 'delivery') }

function uploadFiles(filePaths, uploader, concurrency) {
  const paths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : []
  if (!paths.length) return Promise.resolve([])
  const results = new Array(paths.length)
  const workerCount = Math.min(paths.length, Math.max(1, Number(concurrency) || 3))
  let nextIndex = 0

  function worker() {
    const index = nextIndex
    nextIndex += 1
    if (index >= paths.length) return Promise.resolve()
    return uploader(paths[index]).then(uploadId => {
      results[index] = uploadId
      return worker()
    })
  }

  return Promise.all(Array.from({ length: workerCount }, worker)).then(() => results)
}

function uploadPickupFiles(filePaths) { return uploadFiles(filePaths, uploadPickup, 3) }
function uploadDeliveryFiles(filePaths) { return uploadFiles(filePaths, uploadDelivery, 3) }

module.exports = { uploadPickup, uploadDelivery, uploadPickupFiles, uploadDeliveryFiles }
