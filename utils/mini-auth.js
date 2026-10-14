const { request } = require('./request')
const session = require('./session')

let loginPromise = null
let bootstrapPromise = null

function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: 8000,
      success(result) {
        const code = String(result && result.code || '').trim()
        if (code) resolve(code)
        else reject(new Error('未获取到微信登录凭证'))
      },
      fail: reject
    })
  })
}

function applySession(result) {
  const data = result && typeof result === 'object' ? result : {}
  if (data.registered && data.token) {
    session.setAccessSession(data.token, data.expiresAt)
    session.clearRegistrationSession()
  } else if (!data.registered && data.registrationToken) {
    session.clearAccessSession()
    session.setRegistrationSession(data.registrationToken, data.expiresAt)
  }
  return data
}

function login() {
  if (loginPromise) return loginPromise
  loginPromise = wxLogin().then(code => request({
    url: '/mini/auth/login',
    method: 'POST',
    data: { code },
    skipAuth: true,
    retry: 0,
    showLoading: false,
    errorMessage: '微信登录失败，请检查网络后重试'
  })).then(applySession).finally(() => {
    loginPromise = null
  })
  return loginPromise
}

function submitRegistration(profile, registrationToken) {
  return request({
    url: '/mini/auth/register',
    method: 'POST',
    data: Object.assign({}, profile, { registrationToken }),
    skipAuth: true,
    idempotent: true,
    showLoading: false,
    errorMessage: '注册失败，请稍后重试'
  }).then(applySession)
}

function register(profile, retried) {
  const token = session.getRegistrationToken()
  const prepare = token
    ? Promise.resolve({ registered: false, registrationToken: token })
    : login()
  return prepare.then(result => {
    if (result.registered) return result
    const registrationToken = result.registrationToken || session.getRegistrationToken()
    if (!registrationToken) throw new Error('注册凭证已失效')
    return submitRegistration(profile, registrationToken)
  }).catch(error => {
    if (!retried && error && ['MINI_TOKEN_EXPIRED', 'HTTP_401'].includes(error.code)) {
      session.clearRegistrationSession()
      return login().then(result => result.registered ? result : register(profile, true))
    }
    throw error
  })
}

function hasCompleteProfile(profile) {
  return profile && /^1\d{10}$/.test(String(profile.phone || '')) &&
    /^[1-8]栋$/.test(String(profile.building || '')) && /^\d{3,4}$/.test(String(profile.room || ''))
}

function selectBootstrapProfile(localProfile, options) {
  const source = options && typeof options === 'object' ? options : {}
  const reviewProfile = source.reviewMode === true ? source.reviewProfile : null
  if (hasCompleteProfile(reviewProfile)) return reviewProfile
  return hasCompleteProfile(localProfile) ? localProfile : null
}

function resolveBootstrapOptions(options) {
  const source = options && typeof options === 'object' ? options : {}
  if (!source.ready || typeof source.ready.then !== 'function') return Promise.resolve(source)
  return Promise.resolve(source.ready).then(resolved => Object.assign({}, source, resolved || {}, { ready: null }))
}

function bootstrap(localProfile, options) {
  if (bootstrapPromise) return bootstrapPromise
  // 微信登录与平台设置并行；只有未注册账号需要自动登记时，才等待设置决定是否使用审核资料。
  const loginTask = login()
  bootstrapPromise = Promise.all([loginTask, resolveBootstrapOptions(options)]).then(values => {
    const result = values[0]
    const bootstrapProfile = selectBootstrapProfile(localProfile, values[1])
    if (result.registered) return result
    return bootstrapProfile ? register(bootstrapProfile) : result
  }).finally(() => {
    bootstrapPromise = null
  })
  return bootstrapPromise
}

function updateProfile(profile) {
  return request({
    url: '/mini/me',
    method: 'PUT',
    data: profile,
    idempotent: true,
    errorMessage: '保存失败，请稍后重试'
  }).then(result => result && result.user ? result.user : null)
}

module.exports = { bootstrap, login, register, selectBootstrapProfile, updateProfile }
