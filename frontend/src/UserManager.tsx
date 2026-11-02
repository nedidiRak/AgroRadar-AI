import { useEffect, useState } from 'react'
import { KeyRound, Plus, RotateCcw, Trash2, Users } from 'lucide-react'
import { apiFetch } from './authClient'
import './UserManager.css'

type Viewer = { username: string; role: 'viewer'; created_at: string }
const errorText = async (response: Response) => {
  const json = await response.json().catch(() => ({}))
  return typeof json.detail === 'string' ? json.detail : `HTTP ${response.status}`
}

export default function UserManager() {
  const [users, setUsers] = useState<Viewer[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const response = await apiFetch('/api/auth/users')
      if (!response.ok) throw new Error(await errorText(response))
      const data = await response.json() as { users: Viewer[] }
      setUsers(data.users)
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить пользователей') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch('/api/auth/users', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!response.ok) throw new Error(await errorText(response))
      setNotice(`Пользователь «${username.trim()}» создан. Передай ему пароль безопасным способом.`)
      setUsername(''); setPassword('')
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка создания пользователя') }
    finally { setBusy(false) }
  }
  async function resetPassword(user: Viewer) {
    const value = window.prompt(`Новый пароль для ${user.username} (минимум 10 символов). Текущие сессии будут завершены.`)
    if (value === null) return
    if (value.length < 10) { setError('Пароль должен содержать не менее 10 символов.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch(`/api/auth/users/${encodeURIComponent(user.username)}/password`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: value }),
      })
      if (!response.ok) throw new Error(await errorText(response))
      setNotice(`Пароль для ${user.username} изменён. Его прежние сессии завершены.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка смены пароля') }
    finally { setBusy(false) }
  }
  async function remove(user: Viewer) {
    if (!window.confirm(`Удалить пользователя ${user.username} и немедленно отозвать его доступ?`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await apiFetch(`/api/auth/users/${encodeURIComponent(user.username)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await errorText(response))
      setNotice(`Доступ пользователя ${user.username} отозван.`)
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка удаления пользователя') }
    finally { setBusy(false) }
  }

  return <section className="agr-users-page">
    <div className="agr-users-header"><Users size={23}/><div><h2>Управление доступом</h2><p>Администратор может изменять поля. Наблюдатели только просматривают данные и общаются с ИИ.</p></div></div>
    <div className="agr-users-columns">
      <form className="agr-users-card" onSubmit={e => void create(e)}>
        <h3><Plus size={17}/> Добавить наблюдателя</h3>
        <label htmlFor="new-viewer-login">Логин (латиница)</label>
        <input id="new-viewer-login" required minLength={3} maxLength={32} pattern="[A-Za-z][A-Za-z0-9_.-]{2,31}" autoComplete="off" placeholder="agronom_1" value={username} onChange={e=>setUsername(e.target.value)}/>
        <label htmlFor="new-viewer-password">Пароль (от 10 символов)</label>
        <input id="new-viewer-password" required minLength={10} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Придумай отдельный пароль"/>
        <button disabled={busy || !username.trim() || password.length < 10} type="submit"><Plus size={16}/> Создать пользователя</button>
        <p>У каждого наблюдателя свой логин и пароль. Новые учётные записи сохраняются локально; пароли хранятся в виде хешей.</p>
      </form>
      <div className="agr-users-card">
        <div className="agr-users-list-head"><h3><Users size={17}/> Наблюдатели ({users.length})</h3><button type="button" disabled={busy || loading} onClick={()=>void refresh()} title="Обновить"><RotateCcw size={16}/></button></div>
        {loading && <p>Загружаем пользователей…</p>}
        {!loading && users.length === 0 && <p>Наблюдателей пока нет.</p>}
        <div className="agr-users-list">{users.map(user=><article key={user.username} className="agr-users-item"><div><strong>{user.username}</strong><small>Наблюдатель · создан {user.created_at ? new Date(user.created_at).toLocaleDateString('ru-RU') : '—'}</small></div><div className="agr-users-actions"><button type="button" disabled={busy} title="Сменить пароль" onClick={()=>void resetPassword(user)}><KeyRound size={16}/></button><button type="button" disabled={busy} className="agr-users-delete" title="Удалить и отозвать доступ" onClick={()=>void remove(user)}><Trash2 size={16}/></button></div></article>)}</div>
      </div>
    </div>
    {notice && <div className="action-message" role="status">{notice}</div>}
    {error && <div className="error" role="alert">{error}</div>}
  </section>
}
