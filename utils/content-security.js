/**
 * 图片内容安全审核 — 封装微信原生 imgSecCheck
 * 参考 https://developers.weixin.qq.com/miniprogram/dev/api/imgSecCheck.html
 */
const fs = wx.getFileSystemManager()

/**
 * 从临时文件路径读取 ArrayBuffer
 */
function readBuffer(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      success: res => resolve(res.data),   // res.data 是 ArrayBuffer
      fail: err => reject(err)
    })
  })
}

/**
 * 审核单张图片
 * @param {string} filePath — wx.chooseMedia 返回的 tempFilePath
 * @returns {Promise<{ok:boolean, path:string, reason?:string}>}
 */
function checkImage(filePath) {
  // 微信审核要求文件 ≤ 10MB，提前拒绝超大文件
  return new Promise(resolve => {
    fs.getFileInfo({
      filePath,
      success: info => {
        if (info.size > 10 * 1024 * 1024) {
          resolve({ ok: false, path: filePath, reason: '图片过大，请重新选择' })
          return
        }
        readAndCheck()
      },
      fail: () => readAndCheck()  // 拿不到大小也继续审
    })

    function readAndCheck() {
      readBuffer(filePath).then(buffer => {
        wx.security.imgSecCheck({
          media: {
            contentType: guessContentType(filePath),
            value: buffer
          },
          success: () => resolve({ ok: true, path: filePath }),
          fail: err => {
            const code = err && err.errCode
            // errCode 87014 = 内容违规
            if (code === 87014) {
              resolve({ ok: false, path: filePath, reason: '图片内容违规，请更换' })
            } else {
              // 审核接口偶发失败（网络）放行
              console.warn('imgSecCheck error:', err)
              resolve({ ok: true, path: filePath })
            }
          }
        })
      }).catch(() => {
        // readFile 失败也放行
        resolve({ ok: true, path: filePath })
      })
    }
  })
}

/**
 * 根据扩展名猜测 MIME
 */
function guessContentType(filePath) {
  const lower = String(filePath || '').toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

/**
 * 批量审核图片，返回通过的列表
 * @param {string[]} paths
 * @returns {Promise<{passed:string[], blocked:number}>}
 */
async function checkImages(paths) {
  if (!paths.length) return { passed: [], blocked: 0 }
  wx.showLoading({ title: '审核图片中…', mask: true })
  let blocked = 0
  const passed = []
  const results = new Array(paths.length)
  let nextIndex = 0
  const workerCount = Math.min(3, paths.length)
  async function worker() {
    while (nextIndex < paths.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await checkImage(paths[index])
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker))
  for (const r of results) {
    if (r.ok) {
      passed.push(r.path)
    } else {
      blocked++
      wx.showToast({ title: r.reason || '图片不合规', icon: 'none' })
    }
  }
  wx.hideLoading()
  return { passed, blocked }
}

module.exports = { checkImage, checkImages }
