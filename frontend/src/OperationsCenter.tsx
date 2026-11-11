import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, ClipboardList, Download, FileDown, FileText, History, LockKeyhole, RefreshCcw, ShieldAlert } from 'lucide-react'
import { apiFetch } from './authClient'
import './OperationsCenter.css'
import FieldTasks, { type SuggestedInspection } from './FieldTasks'

type Level = 'high' | 'medium' | 'low' | 'unknown'
type Field = { id: number; name: string; crop: string; risk: { level: Level } }
type Snapshot = {
  id: number; created_at: string; level: Level; source: string
  min_temperature_c: number | null; current_temperature_c: number | null
  known_factors: number; unknown_factors: number
}
type Alert = {
  id: number; field_id: number; field_name: string; factor: string
  title: string; severity: 'high' | 'medium'; status: 'open' | 'acknowledged' | 'resolved'
  reason: string; action: string; source: string; first_seen: string; last_seen: string
  acknowledged_by: string | null
}
type Summary = { monitored_fields: number; open_alerts: number; acknowledged_alerts: number; resolved_alerts: number; activity_count: number }
type Event = { id: number; username: string; action: string; field_id: number | null; created_at: string; details: string }
type Monitor = {enabled:boolean;weather_configured:boolean;running:boolean;last_finished:string|null;processed_fields:number;last_error:string;degraded_fields:number}
type Props = { fields: Field[]; activeId: number; onPick: (id: number) => void; canEdit: boolean; mode: 'demo' | 'live_forecast' }
const levelNames: Record<Level, string> = { high: 'Высокий', medium: 'Умеренный', low: 'Низкий', unknown: 'Нет данных' }

const getJson = async <T,>(url: string): Promise<T> => {
  const response = await apiFetch(url)
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

function TemperatureTrend({ snapshots }: { snapshots: Snapshot[] }) {
  const points = snapshots.filter(p => p.min_temperature_c !== null)
  if (points.length < 2) return <div className="agr-ops-empty">Для графика нужны минимум два сохранённых прогноза. История накопится при обновлении сводки.</div>
  const values = points.map(p => p.min_temperature_c as number)
  const bottom = Math.min(...values) - 2
  const top = Math.max(...values) + 2
  const x = (index: number) => 40 + 660 * index / Math.max(1, values.length - 1)
  const y = (value: number) => 165 - (value - bottom) / Math.max(0.2, top - bottom) * 135
  const path = values.map((val, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(val).toFixed(1)}`).join(' ')
  const zero = y(0)
  return <div className="agr-ops-chart">
    <svg viewBox="0 0 750 205" role="img" aria-label="История минимальных прогнозных температур">
      {[0,1,2,3].map(i => {
        const value = bottom + (top - bottom) * i / 3
        return <g key={i}><line x1="40" y1={y(value)} x2="715" y2={y(value)} stroke="#385a4a" strokeDasharray="3 5"/>
          <text x="8" y={y(value) + 4} fontSize="12" fill="#a4bda9">{value.toFixed(0)}°</text></g>
      })}
      {zero >= 18 && zero <= 185 && <line x1="40" y1={zero} x2="715" y2={zero} stroke="#e5af6c" strokeDasharray="5 4"/>}
      <path d={path} fill="none" stroke="#76d8ad" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
      {points.map((point, index) => <circle key={point.id} cx={x(index)} cy={y(point.min_temperature_c as number)} r="4" fill={point.level === 'high' ? '#fb8685' : '#90e7b7'}>
        <title>{`${new Date(point.created_at).toLocaleString('ru-RU')}: ${point.min_temperature_c} °C · ${levelNames[point.level]} · ${point.source}`}</title>
      </circle>)}
      <text x="40" y="195" fill="#a4bda9" fontSize="11">{new Date(points[0].created_at).toLocaleDateString('ru-RU')}</text>
      <text x="715" y="195" fill="#a4bda9" textAnchor="end" fontSize="11">{new Date(points[points.length - 1].created_at).toLocaleDateString('ru-RU')}</text>
    </svg>
    <p>График показывает <strong>изменение прогнозов</strong> в момент их сохранения, а не измерения температуры датчиком. Демо-прогнозы помечаются в журнале.</p>
  </div>
}

export default function OperationsCenter({ fields, activeId, onPick, canEdit, mode }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [history, setHistory] = useState<Snapshot[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [monitor, setMonitor] = useState<Monitor | null>(null)
  const [status, setStatus] = useState<'all' | 'open' | 'acknowledged' | 'resolved'>('all')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [suggestedInspection, setSuggestedInspection] = useState<SuggestedInspection | null>(null)
  const active = useMemo(() => fields.find(f => f.id === activeId), [fields, activeId])

  async function refresh() {
    setLoading(true); setError('')
    try {
      const [a, b, c, d, m] = await Promise.all([
        getJson<Summary>('/api/operations/summary'),
        getJson<{snapshots: Snapshot[]}>(`/api/operations/fields/${activeId}/history?limit=60`),
        getJson<{alerts: Alert[]}>(`/api/operations/alerts?status=${status}`),
        canEdit ? getJson<{events: Event[]}>('/api/operations/activity?limit=30') : Promise.resolve({ events: [] as Event[] }),
        getJson<Monitor>('/api/operations/monitor'),
      ])
      setSummary(a); setHistory(b.snapshots); setAlerts(c.alerts); setEvents(d.events); setMonitor(m)
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось получить аналитику') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [activeId, status, canEdit])

  async function changeAlert(alert: Alert, next: 'open' | 'acknowledged') {
    setBusy(true); setNotice(''); setError('')
    try {
      const response = await apiFetch(`/api/operations/alerts/${alert.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (!response.ok) throw new Error(await response.text())
      setNotice(next === 'acknowledged' ? 'Предупреждение принято в работу.' : 'Предупреждение снова открыто.')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось обновить предупреждение') }
    finally { setBusy(false) }
  }

  async function forceMonitor() {
    setBusy(true);setError('');setNotice('')
    try {
      const res = await apiFetch('/api/operations/monitor/refresh',{method:'POST'})
      const info = await res.json().catch(()=>({})) as {detail?:string;queued?:boolean;reason?:string}
      if(!res.ok) throw new Error(info.detail||'Не удалось начать проверку')
      setNotice(info.queued ? 'Обновление выбранной партии полей запущено в фоне. Предупреждения обновятся после завершения проверки.' : info.reason||'Проверка уже идёт.')
      await refresh()
    } catch(e) { setError(e instanceof Error?e.message:'Не удалось обновить мониторинг') }
    finally {setBusy(false)}
  }

  const printField = () => {
    if (!active) return
    window.open(`/api/reports/field/${active.id}`, '_blank', 'noopener,noreferrer')
  }
  return <section className="agr-ops">
    <div className="agr-ops-banner"><div><Activity size={22}/><div><strong>Операционный центр хозяйства</strong><p>История погодных рисков, предупреждения и отчёты для принятия решений.</p></div></div>
      <button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCcw size={15}/>{loading ? 'Обновляем…' : 'Обновить'}</button></div>
    {mode === 'demo' && <div className="agr-ops-demo"><AlertTriangle size={17}/> Демонстрационная погода: история и аналитика не являются наблюдениями реального хозяйства. Рабочие предупреждения создаются только из OpenWeather LIVE.</div>}
    {error && <div className="error" role="alert">{error}</div>}
    {notice && <div className="action-message" role="status">{notice}</div>}
    <div className="agr-ops-monitor">
      <div><strong>Фоновый мониторинг · AgroRadar 4.0</strong>
      <p>{!monitor?'Загружаем статус…':monitor.enabled?'Плановое обновление включено':'Плановое обновление выключено'}.
      {' '}За последнюю работу обработано {monitor?.processed_fields??0} участков.
      {monitor?.last_finished&&' Последняя проверка: '+new Date(monitor.last_finished).toLocaleString('ru-RU')+'.'}
      {monitor?.last_error&&' '+monitor.last_error}</p>
      {!monitor?.enabled&&<small>Для непрерывной проверки при запущенном сервере: AGRORADAR_AUTO_MONITOR=1. При 500 полях опрос выполняется ограниченными партиями.</small>}
      </div>
      {canEdit&&<button type="button" disabled={busy||!monitor?.weather_configured||monitor?.running}
        onClick={()=>void forceMonitor()}><RefreshCcw size={15}/> Запустить проверку</button>}
    </div>
    <div className="agr-ops-stats">
      <div><small>Полей с историей</small><strong>{summary?.monitored_fields ?? '—'}</strong></div>
      <div><small>Открытые предупреждения</small><strong>{summary?.open_alerts ?? '—'}</strong></div>
      <div><small>Приняты в работу</small><strong>{summary?.acknowledged_alerts ?? '—'}</strong></div>
      <div><small>Завершённые предупреждения</small><strong>{summary?.resolved_alerts ?? '—'}</strong></div>
    </div>
    <div className="agr-ops-panel">
      <div className="agr-ops-panel-title"><div><h2><History size={19}/> История прогнозов</h2><p>Срезы фиксируются при обновлении сводки, максимум 240 на поле.</p></div>
        <select aria-label="Выбрать поле для истории" value={activeId || ''} onChange={e => onPick(Number(e.target.value))}>
          {fields.map(field => <option value={field.id} key={field.id}>{field.name}</option>)}
        </select></div>
      <TemperatureTrend snapshots={history}/>
      <div className="agr-ops-history-list">
        {history.slice(-6).reverse().map(item => <div key={item.id}>
          <time>{new Date(item.created_at).toLocaleString('ru-RU')}</time>
          <span className={`agr-ops-risk agr-ops-risk--${item.level}`}>{levelNames[item.level]}</span>
          <span>{item.min_temperature_c == null ? 'Нет данных' : `${item.min_temperature_c} °C`}</span>
          <small>{item.source}</small>
        </div>)}
      </div>
    </div>
    <div className="agr-ops-panel">
      <div className="agr-ops-panel-title"><div><h2><ShieldAlert size={19}/> Центр предупреждений</h2><p>Основания и статусы угроз, полученных только из реального прогноза.</p></div>
        <select value={status} onChange={e=>setStatus(e.target.value as typeof status)} aria-label="Статус предупреждений">
          <option value="all">Все статусы</option><option value="open">Открытые</option>
          <option value="acknowledged">Приняты</option><option value="resolved">Завершённые</option>
        </select></div>
      {!alerts.length && <p className="agr-ops-empty">Предупреждений пока нет. При реальном высоком или умеренном риске они появятся здесь автоматически.</p>}
      <div className="agr-ops-alert-list">{alerts.map(alert => <article key={alert.id} className="agr-ops-alert">
        <div className="agr-ops-alert-head"><strong>{alert.field_name} · {alert.title}</strong>
          <span className={`agr-ops-risk agr-ops-risk--${alert.severity}`}>{alert.severity === 'high' ? 'Высокий' : 'Умеренный'} · {alert.status === 'open' ? 'Открыт' : alert.status === 'acknowledged' ? 'Принят' : 'Завершён'}</span></div>
        <p>{alert.reason}</p><p><b>Проверить:</b> {alert.action}</p>
        <small>Источник: {alert.source} · обновлено {new Date(alert.last_seen).toLocaleString('ru-RU')}</small>
        {canEdit && <div className="agr-ops-alert-actions">
          {alert.status !== 'resolved' && <button disabled={busy} onClick={()=>void changeAlert(alert, alert.status === 'open' ? 'acknowledged' : 'open')}>
            <CheckCircle2 size={15}/>{alert.status === 'open' ? 'Принять в работу' : 'Переоткрыть'}
          </button>}
          <button type="button" disabled={busy} onClick={()=>setSuggestedInspection({
            field_id:alert.field_id,alert_id:alert.id,
            title:'Проверить: '+alert.title,
            action:alert.action,
            sequence:Date.now(),
          })}><ClipboardList size={15}/> Создать задание</button>
        </div>}
      </article>)}</div>
    </div>
    <FieldTasks fields={fields} canEdit={canEdit} suggested={suggestedInspection}/>
    <div className="agr-ops-panel">
      <div className="agr-ops-panel-title"><div><h2><FileText size={19}/> Отчётность</h2><p>Отчёт содержит источник, дату, правила рисков и действия агронома.</p></div></div>
      <div className="agr-ops-report-actions">
        <button type="button" onClick={printField} disabled={!active}><FileText size={17}/> Отчёт по полю · печать / PDF</button>
        <a href={active ? `/api/reports/field/${active.id}.csv` : undefined} download><FileDown size={17}/> CSV выбранного поля</a>
        <a href="/api/reports/overview.csv" download><Download size={17}/> CSV всего хозяйства</a>
        {canEdit && <a href="/api/admin/backup" download className="agr-ops-backup"><LockKeyhole size={17}/> Резервная копия данных</a>}
      </div>
      <p className="agr-ops-note">Для PDF нажми «Отчёт по полю» → «Печать / сохранить в PDF». ZIP включает поля, контуры и историю, но не включает API-ключи и пароли. Сохраняй его в защищённом месте.</p>
    </div>
    {canEdit && <details className="agr-ops-panel agr-ops-audit"><summary>Журнал действий администраторов ({events.length} последних записей)</summary>
      {!events.length && <p className="agr-ops-empty">Изменения пока не зафиксированы.</p>}
      {events.map(item=><div key={item.id}><time>{new Date(item.created_at).toLocaleString('ru-RU')}</time> <strong>{item.username}</strong> · {item.action}{item.field_id == null ? '' : ` · поле #${item.field_id}`}</div>)}
    </details>}
  </section>
}
