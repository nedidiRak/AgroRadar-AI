let csrfToken = ''
let currentUser: { username: string; role: 'admin' | 'viewer' } | null = null

export function setCurrentUser(username: string | null | undefined, role: 'admin' | 'viewer' | null | undefined) {
  currentUser = username && role ? { username, role } : null
}

export function getCurrentUser() {
  return currentUser
}

export function setCsrfToken(value: string | null | undefined) {
  csrfToken = value || ''
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-Agro-CSRF', csrfToken)
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' })
  if (response.status === 401) { setCurrentUser(null, null); window.dispatchEvent(new Event('agroradar-auth-expired')) }
  return response
}
