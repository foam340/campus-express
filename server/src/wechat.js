const https = require('https')
const http = require('http')
const config = require('./config')
const { HttpError } = require('./http')

const MAX_RESPONSE_BYTES = 64 * 1024

// --- access_token 缓存 ---
let tokenCache = { value: '', expiresAt: 0 }

async function getAccessToken() {
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - 300000) {
    return tokenCache.value
  }
  const url = new URL('https://api.weixin.qq.com/cgi-bin/token')
  url.searchParams.set('grant_type', 'client_credential')
  url.searchParams.set('appid', config.wechatAppId)
  url.searchParams.set('secret', config.wechatAppSecret)

  const result = await requestJson(url)
  if (!result.access_token) {
    throw new HttpError(502, '获取微信访问凭证失败', 'WECHAT_ACCESS_TOKEN_FAILED')
  }
  tokenCache = {
    value: String(result.access_token),
    expiresAt: Date.now() + Math.min(Number(result.expires_in) || 7200, 7200) * 1000
  }
  return tokenCache.value
}

// --- 图片内容安全审核 ---
const IMG_CHECK_MAX_BYTES = 1024 * 1024 // 微信 img_sec_check 限制 1MB

function imgSecCheck(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    return Promise.reject(new HttpError(400, '图片文件无效', 'IMAGE_INVALID'))
  }
  if (imageBuffer.length > IMG_CHECK_MAX_BYTES) {
    return Promise.reject(new HttpError(400, '图片过大，请压缩后重新上传', 'IMAGE_TOO_LARGE'))
  }
  return getAccessToken().then(accessToken => {
    return new Promise((resolve, reject) => {
      const boundary = `----WxImgSecCheck${Date.now()}`
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="check.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`, 'utf8'),
        imageBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
      ])

      const url = new URL('https://api.weixin.qq.com/wxa/img_sec_check')
      url.searchParams.set('access_token', accessToken)

      const req = https.request(url, {
        method: 'POST',
        timeout: config.wechatRequestTimeout,
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length)
        }
      }, res => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => data += chunk)
        res.on('end', () => {
          try {
            const result = JSON.parse(data)
            if (result.errcode === 87014) {
              // 内容违规
              reject(new HttpError(400, '图片内容违规，请重新选择', 'IMAGE_ILLEGAL'))
            } else if (result.errcode && result.errcode !== 0) {
              // 微信 API 返回错误 — 无法完成审核，拒绝（安全优先）
              console.warn('imgSecCheck api error — rejecting:', result)
              reject(new HttpError(400, '图片审核暂不可用，请重试', 'IMAGE_CHECK_FAILED'))
            } else {
              resolve({ ok: true })
            }
          } catch (e) {
            console.warn('imgSecCheck parse error — rejecting:', e.message)
            reject(new HttpError(400, '图片审核暂不可用，请重试', 'IMAGE_CHECK_FAILED'))
          }
        })
      })
      req.on('timeout', () => req.destroy(new Error('WECHAT_REQUEST_TIMEOUT')))
      req.on('error', err => {
        console.warn('imgSecCheck network error — rejecting:', err.message)
        reject(new HttpError(400, '图片审核暂不可用，请重试', 'IMAGE_CHECK_FAILED'))
      })
      req.write(body)
      req.end()
    })
  })
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      timeout: config.wechatRequestTimeout,
      headers: { Accept: 'application/json' }
    }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('WECHAT_RESPONSE_TOO_LARGE'))
        }
      })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          return reject(new HttpError(502, '微信登录服务暂时不可用', 'WECHAT_HTTP_ERROR'))
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(new HttpError(502, '微信登录服务返回异常', 'WECHAT_INVALID_RESPONSE'))
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('WECHAT_REQUEST_TIMEOUT')))
    request.on('error', error => {
      if (error instanceof HttpError) return reject(error)
      reject(new HttpError(503, '微信登录服务连接失败，请稍后重试', 'WECHAT_UNAVAILABLE'))
    })
  })
}

async function code2Session(code) {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', config.wechatAppId)
  url.searchParams.set('secret', config.wechatAppSecret)
  url.searchParams.set('js_code', code)
  url.searchParams.set('grant_type', 'authorization_code')

  const result = await requestJson(url)
  if (result.errcode) {
    const codeInvalid = Number(result.errcode) === 40029
    throw new HttpError(
      codeInvalid ? 401 : 502,
      codeInvalid ? '微信登录状态已失效，请重试' : '微信登录服务暂时不可用',
      codeInvalid ? 'WECHAT_CODE_INVALID' : 'WECHAT_LOGIN_FAILED'
    )
  }
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(String(result.openid || ''))) {
    throw new HttpError(502, '微信登录服务未返回有效用户标识', 'WECHAT_OPENID_MISSING')
  }
  return {
    openid: String(result.openid),
    unionid: String(result.unionid || '')
  }
}

module.exports = { code2Session, imgSecCheck }
