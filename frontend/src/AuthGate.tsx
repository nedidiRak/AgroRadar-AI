import { useEffect, useState } from 'react'
import { KeyRound, Leaf, LockKeyhole } from 'lucide-react'
import { setCsrfToken, setCurrentUser } from './authClient'
import './AuthGate.css'

type Status = { authenticated: boolean; csrf_token: string | null; username: string | null; role: 'admin' | 'viewer' | null }

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<'loading' | 'login' | 'ready'>('loading')
  const [password, setPassword] = useState('')
  // Phone browsers use a LAN IP: never encourage entry of admin credentials there.
  const localLaptop = ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
  const [username, setUsername] = useState(localLaptop ? 'admin' : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw new Error(`Не удалось проверить доступ (HTTP ${response.status}).`)
        return response.json() as Promise<Status>
      })
      .then(data => {
        if (!active) return
        setCsrfToken(data.csrf_token)
        setCurrentUser(data.username, data.role)
        setState(data.authenticated ? 'ready' : 'login')
      })
      .catch(err => { if (active) { setError(err instanceof Error ? err.message : 'Ошибка соединения'); setState('login') } })
    const expire = () => { setCsrfToken(null); setCurrentUser(null, null); setState('login'); setError('Сессия завершилась. Войди снова.') }
    window.addEventListener('agroradar-auth-expired', expire)
    return () => { active = false; window.removeEventListener('agroradar-auth-expired', expire) }
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !password.trim()) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : 'Ошибка входа.')
      setCsrfToken(result.csrf_token)
      setCurrentUser(result.username, result.role)
      setPassword('')
      setState('ready')
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось войти') }
    finally { setBusy(false) }
  }

  if (state === 'ready') return <>{children}</>
  return <main className="agro-login-page">
    <form className="agro-login-card" onSubmit={submit}>
      <div className="agro-login-mark"><Leaf size={28}/></div>
      <div className="agro-login-overline">AGRO RADAR AI · ДОСТУП К ДАННЫМ</div>
      <h1>Вход администратора</h1>
      <p>Данные полей, прогнозы и ИИ-агроном доступны только после входа.</p>
      {state === 'loading' ? <div className="agro-login-wait">Проверяем сессию…</div> : <>
        <label htmlFor="agro-username">Логин</label>
        <input id="agro-username" type="text" autoComplete="username" maxLength={32} value={username} onChange={event => setUsername(event.target.value)} placeholder={localLaptop ? 'admin или логин наблюдателя' : 'Логин наблюдателя'} required />
        <label htmlFor="agro-admin-password"><KeyRound size={15}/> Пароль</label>
        <input id="agro-admin-password" type="password" autoComplete="current-password"
          value={password} onChange={event => setPassword(event.target.value)}
          placeholder="Введите пароль" required autoFocus />
        {error && <div className="agro-login-error" role="alert">{error}</div>}
        <button type="submit" disabled={busy || !password.trim()}><LockKeyhole size={17}/>{busy ? 'Проверяем…' : 'Войти в AgroRadar'}</button>
        <small>{localLaptop
          ? <>Администратор: <code>admin</code> и пароль из <code>backend/data/admin_access.txt</code>. Для жюри создай наблюдателей в разделе «Пользователи».</>
          : <>Мобильная демонстрация: войди под выданным логином <strong>наблюдателя</strong>. Учётная запись администратора доступна только на ноутбуке.</>}</small>
      </>}
    </form>
  </main>
}
