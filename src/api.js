export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

async function request(path, options = {}) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
  } catch {
    throw new ApiError('서버에 연결할 수 없어요. 서버가 켜져 있는지 확인해 주세요.', 0)
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(data.error ?? '요청을 처리하지 못했어요.', response.status)
  }
  return data
}

export function fetchMe() {
  return request('/me')
}

export function signup(username, password, recovery) {
  return request('/signup', { method: 'POST', body: JSON.stringify({ username, password, ...recovery }) })
}

export function fetchRecoveryQuestion(lookup) {
  return request('/recovery/question', { method: 'POST', body: JSON.stringify(lookup) })
}

export function findUsername(email, securityAnswer) {
  return request('/recovery/username', { method: 'POST', body: JSON.stringify({ email, securityAnswer }) })
}

export function resetPassword(username, email, securityAnswer, newPassword) {
  return request('/recovery/password', {
    method: 'POST',
    body: JSON.stringify({ username, email, securityAnswer, newPassword }),
  })
}

export function updateRecovery(password, recovery) {
  return request('/me/recovery', { method: 'PUT', body: JSON.stringify({ password, ...recovery }) })
}

export function changePassword(password, newPassword) {
  return request('/me/password', { method: 'PUT', body: JSON.stringify({ password, newPassword }) })
}

export function changeEmail(password, email) {
  return request('/me/email', { method: 'PUT', body: JSON.stringify({ password, email }) })
}

export function login(username, password) {
  return request('/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export function logout() {
  return request('/logout', { method: 'POST' })
}

export function withdraw(password) {
  return request('/me', { method: 'DELETE', body: JSON.stringify({ password }) })
}

export function fetchMemos() {
  return request('/memos')
}

export function saveMemos(memos) {
  return request('/memos', { method: 'PUT', body: JSON.stringify({ memos }) })
}

export function fetchAdminUsers() {
  return request('/admin/users')
}

export function fetchAdminUserMemos(userId) {
  return request(`/admin/users/${userId}/memos`)
}

export function updateUser(userId, changes) {
  return request(`/admin/users/${userId}`, { method: 'PATCH', body: JSON.stringify(changes) })
}

export function deleteUserMemo(userId, memoId) {
  return request(`/admin/users/${userId}/memos/${encodeURIComponent(memoId)}`, { method: 'DELETE' })
}

export function deleteUser(userId) {
  return request(`/admin/users/${userId}`, { method: 'DELETE' })
}
