import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import GeoFieldsMap from './GeoFieldsMap'
import { Activity, CloudSun, Leaf, MapPinned, ShieldAlert, RefreshCcw, Pencil, Trash2, X, Save } from 'lucide-react'
import type { FeatureCollection, Polygon } from 'geojson'
import './style.css'
import './FieldsManager.css'

type Weather = { temperature_c:number;humidity_pct:number;wind_ms:number;source:string;observed_at:string|null }
type ForecastPoint = {timestamp:number;temperature_c:number;precipitation_probability_pct:number|null;rain_mm_3h:number|null}
type Forecast = { min_temperature_next_24h_c:number;source:string;sample_count:number;period_hours:number;points?:ForecastPoint[] }
type Risk = {level:'high'|'medium'|'low';label:string;reason:string;basis:string;rule:string;min_temperature_next_24h_c:number}
type Field = {id:number;name:string;crop:string;description:string;kind:'demo'|'user';area_ha:number;lat:number;lon:number;geometry_source?:string;weather:Weather;forecast:Forecast;risk:Risk}
type Dashboard = { fields:Field[];count:number;high_risk_count:number;mode:'demo'|'live_forecast' }

function TemperatureTimeline({forecast}:{forecast:Forecast}) {
  const points = (forecast.points ?? []).slice(0, 9)
  if (!points.length) return <div className="timeline-empty">Нет данных по временным точкам прогноза.</div>
  const temps = points.map(p => p.temperature_c)
  const minT = Math.min(...temps, forecast.min_temperature_next_24h_c) - 1
  const maxT = Math.max(...temps, forecast.min_temperature_next_24h_c) + 1
  const height = 84
  const x = (i:number) => 16 + i * (320 / Math.max(1, points.length - 1))
  const y = (t:number) => 14 + (maxT - t) / Math.max(0.1, maxT - minT) * height
  const path = points.map((p,i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(p.temperature_c).toFixed(1)}`).join(' ')
  const zeroY = y(0)
  const time = (stamp:number) => new Date(stamp*1000).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})
  const demo = forecast.source === 'demo'
  return <section className="forecast-timeline" aria-label="Прогноз температуры на 24 часа">
    <div className="timeline-header"><div><strong>Температура на 24 часа</strong><span>Шаг прогноза — 3 часа</span></div><span className={demo?'timeline-demo':'timeline-live'}>{demo?'ДЕМО · НЕ РЕАЛЬНЫЙ ПРОГНОЗ':'OPENWEATHER · ПРОГНОЗ'}</span></div>
    <svg viewBox="0 0 352 122" className="timeline-chart" role="img" aria-label="График температуры по временным точкам">
      {zeroY >= 0 && zeroY <= 122 && <><line x1="12" x2="342" y1={zeroY} y2={zeroY} stroke="#f6c65b" strokeDasharray="4 4" opacity=".7"/><text x="13" y={Math.max(12,zeroY-4)} fill="#e6c176" fontSize="10">0°C</text></>}
      <path d={path} fill="none" stroke="#72e1b4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p,i)=><g key={p.timestamp}><circle cx={x(i)} cy={y(p.temperature_c)} r="4" stroke="#113c2e" strokeWidth="2" fill={p.temperature_c <= 0?'#fb817b':'#72e1b4'}/><title>{`${time(p.timestamp)}: ${p.temperature_c} °C${p.precipitation_probability_pct===null?'':`, осадки ${p.precipitation_probability_pct}%`}`}</title></g>)}
      <text x="14" y="116" fill="#95b5a5" fontSize="10">{time(points[0].timestamp)}</text>
      <text x="338" y="116" fill="#95b5a5" fontSize="10" textAnchor="end">{time(points[points.length-1].timestamp)}</text>
    </svg>
    <div className="timeline-data">{points.map(p=><div key={p.timestamp} title={p.precipitation_probability_pct===null?'Нет данных о вероятности осадков':`Вероятность осадков: ${p.precipitation_probability_pct}%`}><small>{time(p.timestamp)}</small><strong>{p.temperature_c > 0 ? '+' : ''}{p.temperature_c}°</strong><span>{p.precipitation_probability_pct===null?'—':`☔ ${p.precipitation_probability_pct}%`}</span></div>)}</div>
    <p className="timeline-disclaimer">Значения — прогнозные точки модели, не измерения на поле. Минимум риска рассчитан по температурным минимумам 3-часовых интервалов.</p>
  </section>
}

function App() {
  const [data,setData] = useState<Dashboard|null>(null)
  const [geojson,setGeojson] = useState<FeatureCollection<Polygon>|null>(null)
  const [selected,setSelected] = useState(1)
  const [error,setError] = useState('')
  const [geoError,setGeoError] = useState('')
  const [loading,setLoading] = useState(false)
  const [actionMessage,setActionMessage] = useState('')
  const [dialog,setDialog] = useState<{mode:'create'|'edit';id?:number;outline?:[number,number][]}|null>(null)
  const [form,setForm] = useState({name:'',crop:'',description:''})
  const [formError,setFormError] = useState('')
  const [busy,setBusy] = useState(false)
  async function refresh() {
    setLoading(true); setError(''); setGeoError('')
    try {
      const response = await fetch('/api/dashboard')
      if(!response.ok) {
        const extra = await response.json().catch(()=>null)
        throw new Error(typeof extra?.detail==='string' ? extra.detail : `Сервер вернул ошибку ${response.status}`)
      }
      const next:Dashboard = await response.json()
      setData(next)
      setSelected(previous => next.fields.some(f => f.id === previous) ? previous : (next.fields[0]?.id ?? 0))
    } catch(e) {setError(e instanceof Error ? e.message : 'Не удалось загрузить данные')}
    finally {setLoading(false)}
    try {
      const resp = await fetch('/api/fields.geojson')
      if(!resp.ok) throw new Error(`Ошибка GeoJSON: ${resp.status}`)
      setGeojson(await resp.json())
    } catch(e) {setGeoError(e instanceof Error ? e.message : 'Не удалось загрузить контуры')}
  }
  useEffect(()=>{void refresh()},[])
  function openCreate(outline:[number,number][]) {
    setForm({name:'',crop:'',description:''})
    setFormError('')
    setDialog({mode:'create',outline})
  }
  function openEdit(field:Field) {
    setForm({name:field.name,crop:field.crop,description:field.description??''})
    setFormError('')
    setDialog({mode:'edit',id:field.id})
  }
  function serverMessage(extra:any, status:number):string {
    if(typeof extra?.detail==='string') return extra.detail
    if(Array.isArray(extra?.detail)) return extra.detail.map((x:any)=>x.msg).filter(Boolean).join('; ')
    return `Ошибка API ${status}`
  }
  async function submitField(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(!dialog || busy) return
    setFormError('')
    setBusy(true)
    try {
      const creating = dialog.mode==='create'
      if(creating && (!dialog.outline || dialog.outline.length<3)) throw new Error('Нарисуй хотя бы три вершины поля')
      const url = creating ? '/api/fields' : `/api/fields/${dialog.id}`
      const response = await fetch(url,{
        method:creating?'POST':'PUT',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(creating ? {
          ...form,coordinates:dialog.outline!.map(([lat,lon])=>[lon,lat])
        } : form)
      })
      const result = await response.json().catch(()=>null)
      if(!response.ok) throw new Error(serverMessage(result,response.status))
      setDialog(null)
      if(creating) setSelected(result.field.id)
      await refresh()
      setActionMessage(creating
        ? `Поле «${result.field.name}» создано. Координаты и площадь сохранены.`
        : `Данные поля «${result.field.name}» обновлены.`)
    } catch(e) {
      setFormError(e instanceof Error ? e.message : 'Не удалось сохранить поле')
    } finally { setBusy(false) }
  }
  async function deleteField(field:Field) {
    if(busy || !window.confirm(`Удалить поле «${field.name}» и его контур? Действие нельзя отменить.`)) return
    setBusy(true);setActionMessage('')
    try {
      const response = await fetch(`/api/fields/${field.id}`,{method:'DELETE'})
      if(!response.ok) {
        const result=await response.json().catch(()=>null)
        throw new Error(serverMessage(result,response.status))
      }
      if(selected===field.id) setSelected(0)
      await refresh()
      setActionMessage(`Поле «${field.name}» удалено.`)
    } catch(e) {setActionMessage(e instanceof Error?e.message:'Не удалось удалить поле')}
    finally {setBusy(false)}
  }
  async function saveGeometry(id:number,vertices:[number,number][]):Promise<boolean> {
    setActionMessage('')
    try {
      const response = await fetch(`/api/fields/${id}/geometry`,{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({coordinates:vertices.map(([lat,lon])=>[lon,lat])})
      })
      if(!response.ok) {
        const result=await response.json().catch(()=>null)
        throw new Error(typeof result?.detail==='string'?result.detail:`Ошибка сервера ${response.status}`)
      }
      setActionMessage('Контур поля сохранён. Площадь и координаты пересчитаны.')
      await refresh()
      return true
    } catch(e) {setActionMessage(e instanceof Error?e.message:'Не удалось сохранить контур');return false}
  }
  async function resetGeometry(id:number) {
    setActionMessage('')
    try {
      const response=await fetch(`/api/fields/${id}/geometry`,{method:'DELETE'})
      if(!response.ok) throw new Error(`Ошибка ${response.status}`)
      setActionMessage('Восстановлена демонстрационная граница выбранного поля.')
      await refresh()
    } catch(e) {setActionMessage(e instanceof Error?e.message:'Не удалось сбросить контур')}
  }
  async function importGeoJSON(event:React.ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0]
    event.target.value=''
    if(!file || !active) return
    try {
      const source=JSON.parse(await file.text())
      let polygon=source
      if(source.type==='FeatureCollection') {
        const features=source.features as Array<{properties?:{field_id?:number};geometry?:{type:string;coordinates:unknown}}>
        polygon=(features.find(f=>Number(f.properties?.field_id)===active.id)??(features.length===1?features[0]:null))?.geometry
      } else if(source.type==='Feature') polygon=source.geometry
      if(polygon?.type!=='Polygon'||!Array.isArray(polygon.coordinates?.[0]))
        throw new Error('Нужен GeoJSON Polygon, Feature или FeatureCollection с field_id выбранного поля.')
      const coords=polygon.coordinates[0]
      if(!Array.isArray(coords)) throw new Error('Некорректный контур GeoJSON')
      await saveGeometry(active.id,coords.map(([lon,lat]:[number,number])=>[lat,lon] as [number,number]))
    } catch(e) {setActionMessage(e instanceof Error?e.message:'Не удалось прочитать GeoJSON')}
  }
  function exportGeoJSON(){
    if(!geojson)return
    const blob=new Blob([JSON.stringify(geojson,null,2)],{type:'application/geo+json'})
    const url=URL.createObjectURL(blob)
    const link=document.createElement('a');link.href=url;link.download='agroradar-fields.geojson';link.click()
    setTimeout(()=>URL.revokeObjectURL(url),500)
  }
  const active = data?.fields.find(f=>f.id===selected) ?? data?.fields[0]
  const demo = data?.mode==='demo'
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Leaf size={23}/></div><div><strong>AgroRadar <span>AI</span></strong><small>Аналитика сельхозполей</small></div></div>
      <div className="menu-title">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <div className="menu active"><Activity size={19}/> Обзор полей</div>
      <div className="menu"><MapPinned size={19}/> Карта хозяйства</div>
      <div className="sidebar-bottom">IT-спринт · Русагро<br/>Прототип v1.0</div>
    </aside>
    <main className="content">
      <header><div><div className="eyebrow">МОНИТОРИНГ / ОБЗОР</div><h1>Обзор хозяйства</h1><p>Метеоусловия и прогноз температурных рисков на 24 часа</p></div><button onClick={()=>void refresh()} disabled={loading}><RefreshCcw size={17}/>{loading?'Обновление…':'Обновить'}</button></header>
      {error && <div className="error">{error} Проверь FastAPI на порту 8000.</div>}
      {actionMessage && <div className="action-message">{actionMessage}</div>}
      {geoError && <div className="error">{geoError}. Точечные маркеры продолжат работать, если есть данные полей.</div>}
      <div className="notice">{demo
        ? 'ДЕМОРЕЖИМ · Погода и исходные поля примерные; спутниковая подложка Яндекс Карт онлайн. Настрой OPENWEATHER_API_KEY для реальной погоды.'
        : data ? 'OPENWEATHER LIVE · Текущая погода и прогноз 3-часовыми шагами. Карта Яндекс онлайн; не обведённые поля демонстрационные.'
        : 'Загрузка данных…'} Риск — температурное правило, не агрономический диагноз.</div>
      <section className="stats">
        <div className="stat"><div className="stat-label"><MapPinned size={18}/> Всего полей</div><strong>{data?.count??'—'}</strong><small>Участков в хозяйстве</small></div>
        <div className="stat"><div className="stat-label"><ShieldAlert size={18}/> Высокий риск за 24 ч</div><strong className="danger">{data?.high_risk_count??'—'}</strong><small>По минимальной прогнозной температуре</small></div>
        <div className="stat"><div className="stat-label"><CloudSun size={18}/> Сейчас на поле</div><strong>{active?`${active.weather.temperature_c}°`:'—'}</strong><small>{active?.name??'Выберите поле'}</small></div>
      </section>
      <section className="workspace"><div className="map-panel"><div className="panel-head"><h2>Спутниковая карта полей</h2><span>● WGS84 · настоящая местность</span></div><div className="map-wrap"><GeoFieldsMap fields={data?.fields??[]} geojson={geojson} activeId={active?.id} onSelect={setSelected} onSaveGeometry={saveGeometry} onCreateOutline={openCreate}/></div><div className="map-foot"><span><i className="dot green"/> Низкий</span><span><i className="dot yellow"/> Умеренный</span><span><i className="dot red"/> Высокий</span></div></div>
      <div className="details"><div className="panel-head"><h2>Информация о поле</h2></div>
        <label htmlFor="field-picker">Выберите поле</label>
        <select id="field-picker" value={active?.id??''} onChange={e=>setSelected(Number(e.target.value))}>
          {!active && <option value="">Нет полей</option>}
          {data?.fields.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        {active ? <>
          <div className="field-heading"><div className="field-name">{active.name}</div>
            <div className="field-edit-actions">
              <button type="button" onClick={()=>openEdit(active)} disabled={busy} title="Переименовать, указать культуру и описание"><Pencil size={14}/> Изменить</button>
              <button type="button" className="field-delete" onClick={()=>void deleteField(active)} disabled={busy} title="Удалить поле навсегда"><Trash2 size={14}/> Удалить</button>
            </div>
          </div>
          <div className="geometry-status">{active.geometry_source==='user_drawn'?'● Границы нанесены вручную':'◌ Границы демонстрационные — не измерены'}</div>
          <div className="muted">{active.crop} · {active.area_ha} га · {active.lat.toFixed(4)}° N, {active.lon.toFixed(4)}° E</div>
          <div className="field-description"><span>Описание участка</span><p>{active.description || 'Описание пока не добавлено. Нажми «Изменить», чтобы заполнить его.'}</p></div>
          <div className="weather-grid"><div><small>Температура сейчас</small><b>{active.weather.temperature_c} °C</b></div><div><small>Мин. за 24 часа</small><b>{active.forecast.min_temperature_next_24h_c} °C</b></div><div><small>Влажность</small><b>{active.weather.humidity_pct}%</b></div><div><small>Ветер</small><b>{active.weather.wind_ms} м/с</b></div><div><small>Источник</small><b>{active.weather.source==='demo'?'Демо':'OpenWeather'}</b></div><div><small>Горизонт</small><b>24 часа</b></div></div>
          <TemperatureTimeline forecast={active.forecast}/>
          <div className={`risk risk-${active.risk.level}`}><div>● {active.risk.label} температурный риск</div><p>{active.risk.reason}</p></div>
          <p className="disclaimer">Пороговое правило: ≤0 °C — высокий риск, до +3 °C — умеренный, выше — низкий. Используется минимальная прогнозная температура за 24 часа (модель 3-часового прогноза). Для оценки повреждений нужно учитывать культуру, фазу развития и местный микроклимат.</p>
        </> : <div className="field-empty">Полей пока нет. Нажми «Новое поле» над картой, обведи участок и заполни карточку.</div>}
      </div></section>
      <section className="gis-tools"><div><strong>Работа с геоданными</strong><p>Для нового участка нажми «Новое поле» над картой. «Изменить контур» корректирует существующий. Импорт GeoJSON заменяет границу выбранного поля.</p></div><div className="gis-actions"><label className="file-btn">↑ Контур выбранного поля<input type="file" accept=".json,.geojson,application/geo+json" onChange={e=>void importGeoJSON(e)} hidden/></label><button type="button" onClick={exportGeoJSON} disabled={!geojson}>↓ Экспорт GeoJSON</button>{active?.kind==='demo' && active?.geometry_source==='user_drawn' && <button type="button" className="outline-danger" onClick={()=>void resetGeometry(active.id)}>Сбросить контур</button>}</div></section>
      {dialog && <div className="field-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget && !busy) setDialog(null)}}>
        <div className="field-modal" role="dialog" aria-modal="true" aria-labelledby="field-dialog-title">
          <form onSubmit={e=>void submitField(e)}>
            <div className="field-modal__heading"><div><span>{dialog.mode==='create'?'НОВЫЙ УЧАСТОК · ШАГ 2 / 2':'КАРТОЧКА УЧАСТКА'}</span>
              <h2 id="field-dialog-title">{dialog.mode==='create'?'Создать поле':'Редактировать поле'}</h2>
              <p>{dialog.mode==='create'?'Контур уже нарисован. Назови поле и укажи культуру.':'Измени название, культуру или описание. Контур останется прежним.'}</p>
            </div><button type="button" className="field-modal__close" onClick={()=>setDialog(null)} disabled={busy} aria-label="Закрыть"><X size={18}/></button></div>
            <label htmlFor="field-name-input">Название поля <em>*</em></label>
            <input id="field-name-input" autoFocus required maxLength={100} value={form.name} onChange={e=>setForm(prev=>({...prev,name:e.target.value}))} placeholder="Например, Поле Лесное" />
            <label htmlFor="field-crop-input">Культура <em>*</em></label>
            <input id="field-crop-input" required maxLength={80} value={form.crop} onChange={e=>setForm(prev=>({...prev,crop:e.target.value}))} placeholder="Например, озимая пшеница" list="agro-crops" />
            <datalist id="agro-crops"><option value="Пшеница"/><option value="Озимая пшеница"/><option value="Подсолнечник"/><option value="Кукуруза"/><option value="Ячмень"/><option value="Соя"/><option value="Рапс"/><option value="Сахарная свёкла"/></datalist>
            <label htmlFor="field-description-input">Описание / заметки</label>
            <textarea id="field-description-input" rows={4} maxLength={2000} value={form.description} onChange={e=>setForm(prev=>({...prev,description:e.target.value}))} placeholder="Сорт, дата посева, почва, состояние культуры, наблюдения агронома…" />
            {dialog.mode==='create' && <div className="field-modal__hint">Вершин контура: {dialog.outline?.length ?? 0}. Площадь и центр автоматически определит сервер.</div>}
            {formError && <div className="field-modal__error" role="alert">{formError}</div>}
            <div className="field-modal__footer"><button type="button" className="field-modal__cancel" onClick={()=>setDialog(null)} disabled={busy}>Отмена</button>
              <button type="submit" disabled={busy}><Save size={16}/>{busy?'Сохранение…':dialog.mode==='create'?'Создать поле':'Сохранить изменения'}</button></div>
          </form>
        </div>
      </div>}
      <footer>AgroRadar AI · MVP 1.0 · Картографическая подложка Яндекс Карт (онлайн) · GeoJSON-контуры · Демонстрационная геометрия не является кадастровой · Условия использования: Яндекс Карты</footer>
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
