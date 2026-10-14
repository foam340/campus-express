const SESSION_KEY = 'campus_admin_session_v1'

export function readSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    if (!value || !value.token || Number(value.expiresAt || 0) <= Date.now()) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return value
  } catch (error) {
    sessionStorage.removeItem(SESSION_KEY)
    return null
  }
}

export function saveSession(session) {
  if (!session || !session.token) return false
  const safe = {
    token: String(session.token),
    expiresAt: Number(session.expiresAt) || Date.now() + 2 * 60 * 60 * 1000,
    admin: session.admin && typeof session.admin === 'object' ? session.admin : { name: '管理员' }
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(safe))
  return true
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY)
}
