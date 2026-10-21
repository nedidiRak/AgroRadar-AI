import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import { Activity, CloudSun, Leaf, MapPinned, ShieldAlert, RefreshCcw } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './style.css'

type Weather = { temperature_c: number; humidity_pct: number; wind_ms: number; source: string; observed_at: string | null }
type Risk = { level: 'high'|'medium'|'low'; label: string; reason: string }
type Field = { id: number; name: string; crop: string; area_ha: number; lat: number; lon: number; weather: Weather; risk: Risk }
type Dashboard = { fields: Field[]; count: number; high_risk_count: number; mode: string }
const riskColors = { high: '#ef6666', medium: '#e8b74f', low: '#56c6a0' }

function Recenter({ field }: { field?: Field }) {
  const map = useMap()
  useEffect(() => { if (field) map.flyTo([field.lat, field.lon], 11, { duration: 0.7 }) }, [field, map])
  return null
}
function App() {
  const [data, setData] = useState<Dashboard|null>(null)
  const [selected, setSelected] = useState<number>(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function refresh() {
    setLoading(true); setError('')
    try {
      const response = await fetch('/api/dashboard')
      if (!response.ok) throw new Error(`Сервер вернул ошибку ${response.status}`)
      setData(await response.json())
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось загрузить данные') }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const active = data?.fields.find(f => f.id === selected) || data?.fields[0]
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Leaf size={23}/></div><div><strong>AgroRadar <span>AI</span></strong><small>Аналитика сельхозполей</small></div></div>
      <div className="menu-title">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <div className="menu active"><Activity size={19}/> Обзор полей</div>
      <div className="menu"><MapPinned size={19}/> Карта хозяйства</div>
      <div className="sidebar-bottom">IT-спринт · Русагро<br/>Прототип v0.1</div>
    </aside>
    <main className="content">
      <header><div><div className="eyebrow">МОНИТОРИНГ / ОБЗОР</div><h1>Обзор хозяйства</h1><p>Состояние полей и температурные риски</p></div><button onClick={() => void refresh()} disabled={loading}><RefreshCcw size={17}/> {loading?'Обновление…':'Обновить'}</button></header>
      {error && <div className="error">{error}. Убедитесь, что FastAPI запущен на порту 8000.</div>}
      <div className="notice">{data?.mode === 'demo' ? 'ДЕМОРЕЖИМ · Все поля и погодные показатели вымышлены.' : data ? 'РЕАЛЬНАЯ ПОГОДА · Поля демонстрационные. Данные — текущие наблюдения, не прогноз.' : 'Загрузка данных…'} Риски основаны только на температурных порогах.</div>
      <section className="stats">
        <div className="stat"><div className="stat-label"><MapPinned size={18}/> Всего полей</div><strong>{data?.count ?? '—'}</strong><small>Демонстрационное хозяйство</small></div>
        <div className="stat"><div className="stat-label"><ShieldAlert size={18}/> Высокий риск</div><strong className="danger">{data?.high_risk_count ?? '—'}</strong><small>По температурному индикатору</small></div>
        <div className="stat"><div className="stat-label"><CloudSun size={18}/> Температура поля</div><strong>{active ? `${active.weather.temperature_c}°` : '—'}</strong><small>{active?.name ?? 'Выберите поле'}</small></div>
      </section>
      <section className="workspace"><div className="map-panel"><div className="panel-head"><h2>Карта полей</h2><span>● Объекты хозяйства</span></div><div className="map-wrap"><MapContainer center={[50.601,36.58]} zoom={10} scrollWheelZoom={true} style={{height:'100%',width:'100%'}}><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Recenter field={active}/>{data?.fields.map(f=><CircleMarker key={f.id} center={[f.lat,f.lon]} radius={f.id===active?.id?15:11} pathOptions={{color:'#fff',weight:3,fillColor:riskColors[f.risk.level],fillOpacity:0.96}} eventHandlers={{click:()=>setSelected(f.id)}}><Popup><strong>{f.name}</strong><br/>{f.crop} · {f.area_ha} га<br/>Риск: {f.risk.label}</Popup></CircleMarker>)}</MapContainer></div><div className="map-foot"><span><i className="dot green"/> Низкий</span><span><i className="dot yellow"/> Умеренный</span><span><i className="dot red"/> Высокий</span></div></div>
      <div className="details"><div className="panel-head"><h2>Информация о поле</h2></div><label>Выберите поле</label><select value={active?.id ?? ''} onChange={e=>setSelected(Number(e.target.value))}>{data?.fields.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>{active ? <><div className="field-name">{active.name}</div><div className="muted">{active.crop} · {active.area_ha} га</div><div className="weather-grid"><div><small>Температура</small><b>{active.weather.temperature_c} °C</b></div><div><small>Влажность</small><b>{active.weather.humidity_pct}%</b></div><div><small>Ветер</small><b>{active.weather.wind_ms} м/с</b></div><div><small>Источник</small><b>{active.weather.source==='demo'?'Демо':'OpenWeather'}</b></div></div><div className={`risk risk-${active.risk.level}`}><div>● {active.risk.label} температурный риск</div><p>{active.risk.reason}</p></div><p className="disclaimer">Это предварительный индикатор, а не прогноз повреждения культуры. Для агрономического решения нужны данные о культуре и фазе развития.</p></> : <p>Загрузка поля…</p>}</div></section>
      <footer>AgroRadar AI · MVP 0.1 · Данные демополей вымышлены · OpenStreetMap contributors</footer>
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
