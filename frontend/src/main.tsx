import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import GeoFieldsMap from './GeoFieldsMap'
import { Activity, CloudSun, Leaf, MapPinned, ShieldAlert, RefreshCcw } from 'lucide-react'
import type { FeatureCollection, Polygon } from 'geojson'
import './style.css'

type Weather = { temperature_c:number;humidity_pct:number;wind_ms:number;source:string;observed_at:string|null }
type Forecast = { min_temperature_next_24h_c:number;source:string;sample_count:number;period_hours:number }
type Risk = {level:'high'|'medium'|'low';label:string;reason:string;basis:string;rule:string;min_temperature_next_24h_c:number}
type Field = {id:number;name:string;crop:string;area_ha:number;lat:number;lon:number;weather:Weather;forecast:Forecast;risk:Risk}
type Dashboard = { fields:Field[];count:number;high_risk_count:number;mode:'demo'|'live_forecast' }

function App() {
  const [data,setData] = useState<Dashboard|null>(null)
  const [geojson,setGeojson] = useState<FeatureCollection<Polygon>|null>(null)
  const [selected,setSelected] = useState(1)
  const [error,setError] = useState('')
  const [geoError,setGeoError] = useState('')
  const [loading,setLoading] = useState(false)
  async function refresh() {
    setLoading(true); setError(''); setGeoError('')
    try {
      const response = await fetch('/api/dashboard')
      if(!response.ok) {
        const extra = await response.json().catch(()=>null)
        throw new Error(typeof extra?.detail==='string' ? extra.detail : `Сервер вернул ошибку ${response.status}`)
      }
      setData(await response.json())
    } catch(e) {setError(e instanceof Error ? e.message : 'Не удалось загрузить данные')}
    finally {setLoading(false)}
    try {
      const resp = await fetch('/api/fields.geojson')
      if(!resp.ok) throw new Error(`Ошибка GeoJSON: ${resp.status}`)
      setGeojson(await resp.json())
    } catch(e) {setGeoError(e instanceof Error ? e.message : 'Не удалось загрузить контуры')}
  }
  useEffect(()=>{void refresh()},[])
  const active = data?.fields.find(f=>f.id===selected) ?? data?.fields[0]
  const demo = data?.mode==='demo'
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Leaf size={23}/></div><div><strong>AgroRadar <span>AI</span></strong><small>Аналитика сельхозполей</small></div></div>
      <div className="menu-title">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <div className="menu active"><Activity size={19}/> Обзор полей</div>
      <div className="menu"><MapPinned size={19}/> Карта хозяйства</div>
      <div className="sidebar-bottom">IT-спринт · Русагро<br/>Прототип v0.4</div>
    </aside>
    <main className="content">
      <header><div><div className="eyebrow">МОНИТОРИНГ / ОБЗОР</div><h1>Обзор хозяйства</h1><p>Метеоусловия и прогноз температурных рисков на 24 часа</p></div><button onClick={()=>void refresh()} disabled={loading}><RefreshCcw size={17}/>{loading?'Обновление…':'Обновить'}</button></header>
      {error && <div className="error">{error} Проверь FastAPI на порту 8000.</div>}
      {geoError && <div className="error">{geoError}. Точечные маркеры продолжат работать, если есть данные полей.</div>}
      <div className="notice">{demo
        ? 'ДЕМОРЕЖИМ · Поля, геометрия и погода вымышлены. Настрой OPENWEATHER_API_KEY для получения реальных метеоданных.'
        : data ? 'OPENWEATHER LIVE · Текущая погода и прогноз 3-часовыми шагами. Поля и границы остаются демонстрационными.'
        : 'Загрузка данных…'} Риск — температурное правило, не агрономический диагноз.</div>
      <section className="stats">
        <div className="stat"><div className="stat-label"><MapPinned size={18}/> Всего полей</div><strong>{data?.count??'—'}</strong><small>Демонстрационное хозяйство</small></div>
        <div className="stat"><div className="stat-label"><ShieldAlert size={18}/> Высокий риск за 24 ч</div><strong className="danger">{data?.high_risk_count??'—'}</strong><small>По минимальной прогнозной температуре</small></div>
        <div className="stat"><div className="stat-label"><CloudSun size={18}/> Сейчас на поле</div><strong>{active?`${active.weather.temperature_c}°`:'—'}</strong><small>{active?.name??'Выберите поле'}</small></div>
      </section>
      <section className="workspace"><div className="map-panel"><div className="panel-head"><h2>Геокарта полей</h2><span>● Координаты WGS84</span></div><div className="map-wrap"><GeoFieldsMap fields={data?.fields??[]} geojson={geojson} activeId={active?.id} onSelect={setSelected}/></div><div className="map-foot"><span><i className="dot green"/> Низкий</span><span><i className="dot yellow"/> Умеренный</span><span><i className="dot red"/> Высокий</span></div></div>
      <div className="details"><div className="panel-head"><h2>Информация о поле</h2></div><label>Выберите поле</label><select value={active?.id??''} onChange={e=>setSelected(Number(e.target.value))}>{data?.fields.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>{active ? <><div className="field-name">{active.name}</div><div className="muted">{active.crop} · {active.area_ha} га · {active.lat.toFixed(4)}° N, {active.lon.toFixed(4)}° E</div><div className="weather-grid"><div><small>Температура сейчас</small><b>{active.weather.temperature_c} °C</b></div><div><small>Мин. за 24 часа</small><b>{active.forecast.min_temperature_next_24h_c} °C</b></div><div><small>Влажность</small><b>{active.weather.humidity_pct}%</b></div><div><small>Ветер</small><b>{active.weather.wind_ms} м/с</b></div><div><small>Источник</small><b>{active.weather.source==='demo'?'Демо':'OpenWeather'}</b></div><div><small>Горизонт</small><b>24 часа</b></div></div><div className={`risk risk-${active.risk.level}`}><div>● {active.risk.label} температурный риск</div><p>{active.risk.reason}</p></div><p className="disclaimer">Пороговое правило: ≤0 °C — высокий риск, до +3 °C — умеренный, выше — низкий. Используется минимальная прогнозная температура за 24 часа (модель 3-часового прогноза). Для оценки повреждений нужно учитывать культуру, фазу развития и местный микроклимат.</p></>:<p className="disclaimer">Загрузка поля…</p>}</div></section>
      <footer>AgroRadar AI · MVP 0.4 · Координатная схема без картографической подложки · Геометрии демонстрационные, не кадастровые · Локально карта работает без внешних сервисов</footer>
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
