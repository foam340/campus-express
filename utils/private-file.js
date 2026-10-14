const config = require('../config/index')
const session = require('./session')
const fileCache = new Map()
const inflightDownloads = new Map()
const MAX_CACHED_FILES = 100
const CACHE_TTL_MS = 5 * 60 * 1000
let cacheGeneration = 0

function cacheKey(token, url) { return `${String(token).slice(-16)}:${url}` }

function cachedFile(key) {
  const item = fileCache.get(key)
  if (!item || item.expiresAt <= Date.now()) {
    if (item) forgetFile(key, item.filePath)
    return ''
  }
  try {
    wx.getFileSystemManager().accessSync(item.filePath)
    return item.filePath
  } catch (error) {
    fileCache.delete(key)
    return ''
  }
}

function removeTempFile(filePath) {
  if (!filePath) return
  try { wx.getFileSystemManager().unlink({ filePath, fail() {} }) } catch (error) { /* 临时文件可能已由微信清理 */ }
}

function forgetFile(key, filePath) {
  fileCache.delete(key)
  removeTempFile(filePath)
}

function rememberFile(key, filePath) {
  if (!key || !filePath) return
  const previous = fileCache.get(key)
  if (previous && previous.filePath !== filePath) removeTempFile(previous.filePath)
  fileCache.delete(key)
  fileCache.set(key, { filePath, expiresAt: Date.now() + CACHE_TTL_MS })
  while (fileCache.size > MAX_CACHED_FILES) {
    const oldestKey = fileCache.keys().next().value
    const oldest = fileCache.get(oldestKey)
    forgetFile(oldestKey, oldest && oldest.filePath)
  }
}

function downloadPrivateFile(url) {
  const token = session.getAccessToken()
  if (!token || !url) return Promise.resolve('')
  const key = cacheKey(token, url)
  const cached = cachedFile(key)
  if (cached) return Promise.resolve(cached)
  if (inflightDownloads.has(key)) return inflightDownloads.get(key)
  const generation = cacheGeneration
  const task = new Promise(resolve => {
    wx.downloadFile({
      url: /^https:\/\//.test(url) ? url : `${String(config.apiBaseUrl || '').replace(/\/$/, '')}${url}`,
      header: { Authorization: `Bearer ${token}` },
      timeout: 30000,
      success(result) {
        const filePath = result && result.statusCode >= 200 && result.statusCode < 300 ? result.tempFilePath || '' : ''
        if (filePath && generation === cacheGeneration) {
          rememberFile(key, filePath)
          resolve(filePath)
        } else {
          removeTempFile(filePath)
          resolve('')
        }
      },
      fail() { resolve('') }
    })
  }).finally(() => inflightDownloads.delete(key))
  inflightDownloads.set(key, task)
  return task
}

function downloadPrivateFiles(urls) {
  const values = Array.isArray(urls) ? urls.filter(Boolean) : []
  return Promise.all(values.map(downloadPrivateFile)).then(items => items.filter(Boolean))
}

function clearPrivateFileCache() {
  cacheGeneration += 1
  for (const [key, item] of fileCache.entries()) forgetFile(key, item && item.filePath)
  inflightDownloads.clear()
}

module.exports = { clearPrivateFileCache, downloadPrivateFile, downloadPrivateFiles }
