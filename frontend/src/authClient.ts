let csrfToken = ''

export function setCsrfToken(value: string | null | undefined) {
  csrfToken = value || ''
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase()
  const headers = new Headers(init.headers)
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-Agro-CSRF', csrfToken)
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' })
  if (response.status === 401) window.dispatchEvent(new Event('agroradar-auth-expired'))
  return response
}
