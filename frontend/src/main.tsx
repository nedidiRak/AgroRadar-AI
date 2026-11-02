import AuthGate from './AuthGate'
import { apiFetch } from './authClient'
import { setCsrfToken } from './authClient'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import GeoFieldsMap from './GeoFieldsMap'
import AiAgronom from './AiAgronom'
import RiskDashboard from './RiskDashboard'
import type { RiskAnalysis } from './RiskDashboard'
import { Activity, Leaf, MapPinned, ShieldAlert, RefreshCcw, Pencil, Trash2, X, Save, Bot, ArrowRight, ChevronDown, Search, SlidersHorizontal, Info, Thermometer, Wind, Droplets, CheckCircle2, LogOut } from 'lucide-react'
import type { FeatureCollection, Polygon } from 'geojson'
import './style.css'
import './FieldsManager.css'
import './layout-v1.2.css'
import './mobile-v1.3.css'
import './agronomy-v2.1.css'

type Weather = { temperature_c:number|null;humidity_pct:number|null;wind_ms:number|null;source:string;observed_at:string|null }
type ForecastPoint = {timestamp:number;temperature_c:number;precipitation_probability_pct:number|null;rain_mm_3h:number|null}
type Forecast = { min_temperature_next_24h_c:number|null;source:string;sample_count:number;period_hours:number;points?:ForecastPoint[] }
type Risk = {level:'high'|'medium'|'low'|'unknown';label:string;reason:string;basis:string;rule:string;min_temperature_next_24h_c:number|null}
type Observation = {id:string;observed_on:string;recorded_at:string;text:string;source:'manual'}
type Field = {id:number;name:string;crop:string;description:string;sowing_date?:string;growth_stage?:string;soil_type?:string;observations?:Observation[];kind:'demo'|'user';area_ha:number;lat:number;lon:number;geometry_source?:string;weather:Weather;forecast:Forecast;risk:Risk; risk_analysis?:RiskAnalysis;temperature_risk?:Risk}
type Dashboard = { fields:Field[];count:number;high_risk_count:number;degraded_count?:number;degraded_field_ids?:number[];mode:'demo'|'live_forecast' }
type View = 'overview' | 'fields' | 'assistant'
const navigation: {id: View; label:string; Icon: typeof Activity}[] = [
  {id:'overview', label:'Обзор',Icon:Activity},
  {id:'fields',label:'Карта и поля',Icon:MapPinned},
  {id:'assistant',label:'ИИ-агроном',Icon:Bot},
]
const riskLabel = {high:'Высокий',medium:'Умеренный',low:'Низкий',unknown:'Нет данных'} as const
const riskOrder = {high:0,medium:1,low:2,unknown:3} as const
const weatherText = (value:number|null|undefined, unit:string) => value == null ? '—' : `${value} ${unit}`

function TemperatureTimeline({forecast}:{forecast:Forecast}) {
  const points = (forecast.points ?? []).slice(0, 9)
  if (!points.length) return <div className="timeline-empty">Нет данных по временным точкам прогноза.</div>
  const temps = points.map(p => p.temperature_c)
  const minT = Math.min(...temps, ...(forecast.min_temperature_next_24h_c == null ? [] : [forecast.min_temperature_next_24h_c])) - 1
  const maxT = Math.max(...temps, ...(forecast.min_temperature_next_24h_c == null ? [] : [forecast.min_temperature_next_24h_c])) + 1
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
  const [form,setForm] = useState({name:'',crop:'',description:'',sowing_date:'',growth_stage:'',soil_type:''})
  const [formError,setFormError] = useState('')
  const [busy,setBusy] = useState(false)
  const [view,setView] = useState<View>('overview')
  const [visitedMap,setVisitedMap] = useState(false)
  const [visitedAi,setVisitedAi] = useState(false)
  const [fieldQuery,setFieldQuery] = useState('')
  const [showFieldDetails,setShowFieldDetails] = useState(false)
  const [observationText,setObservationText] = useState('')
  const [observationDate,setObservationDate] = useState('')
  const [observationBusy,setObservationBusy] = useState(false)
  useEffect(()=>{ setObservationText(''); setObservationDate('') },[selected])
  function navigate(to:View) {
    if(to==='fields') setVisitedMap(true)
    if(to==='assistant') setVisitedAi(true)
    setView(to)
    window.scrollTo({top:0,behavior:'auto'})
  }
  async function logout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } finally {
      setCsrfToken(null)
      window.location.reload()
    }
  }
  async function refresh() {
    setLoading(true); setError(''); setGeoError('')
    try {
      const response = await apiFetch('/api/dashboard')
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
      const resp = await apiFetch('/api/fields.geojson')
      if(!resp.ok) throw new Error(`Ошибка GeoJSON: ${resp.status}`)
      setGeojson(await resp.json())
    } catch(e) {setGeoError(e instanceof Error ? e.message : 'Не удалось загрузить контуры')}
  }
  useEffect(()=>{void refresh()},[])
  function openCreate(outline:[number,number][]) {
    setForm({name:'',crop:'',description:'',sowing_date:'',growth_stage:'',soil_type:''})
    setFormError('')
    setDialog({mode:'create',outline})
  }
  function openEdit(field:Field) {
    setForm({name:field.name,crop:field.crop,description:field.description??'',sowing_date:field.sowing_date??'',growth_stage:field.growth_stage??'',soil_type:field.soil_type??''})
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
      const response = await apiFetch(url,{
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
  async function addObservation(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!active || observationBusy || !observationText.trim()) return
    setObservationBusy(true)
    try {
      const response = await apiFetch(`/api/fields/${active.id}/observations`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text:observationText.trim(), observed_on:observationDate || null}),
      })
      const result = await response.json().catch(()=>null)
      if (!response.ok) throw new Error(serverMessage(result,response.status))
      setObservationText('')
      setObservationDate('')
      await refresh()
      setActionMessage('Наблюдение добавлено в журнал поля.')
    } catch (e) {setActionMessage(e instanceof Error?e.message:'Не удалось добавить наблюдение')}
    finally {setObservationBusy(false)}
  }
  async function removeObservation(fieldId:number, observation:Observation) {
    if (observationBusy || !window.confirm(`Удалить наблюдение от ${observation.observed_on}?`)) return
    setObservationBusy(true)
    try {
      const response = await apiFetch(`/api/fields/${fieldId}/observations/${observation.id}`, {method:'DELETE'})
      if (!response.ok) {
        const result = await response.json().catch(()=>null)
        throw new Error(serverMessage(result,response.status))
      }
      await refresh()
      setActionMessage('Наблюдение удалено.')
    } catch (e) {setActionMessage(e instanceof Error?e.message:'Не удалось удалить наблюдение')}
    finally {setObservationBusy(false)}
  }
  async function deleteField(field:Field) {
    if(busy || !window.confirm(`Удалить поле «${field.name}» и его контур? Действие нельзя отменить.`)) return
    setBusy(true);setActionMessage('')
    try {
      const response = await apiFetch(`/api/fields/${field.id}`,{method:'DELETE'})
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
      const response = await apiFetch(`/api/fields/${id}/geometry`,{
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
      const response=await apiFetch(`/api/fields/${id}/geometry`,{method:'DELETE'})
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
  const filteredFields = (data?.fields ?? []).filter(f=>`${f.name} ${f.crop}`.toLocaleLowerCase('ru-RU').includes(fieldQuery.toLocaleLowerCase('ru-RU')))
  const sortedFields = [...(data?.fields ?? [])].sort((a,b)=>(riskOrder[a.risk.level]-riskOrder[b.risk.level]))
  const pageInfo = {
    overview:['Обзор хозяйства','Погода и риски — самое важное за ближайшие 24 часа.'],
    fields:['Карта и поля','Управляй участками, границами и карточками культур.'],
    assistant:['ИИ-агроном','Обсуди выбранный участок с помощником DeepSeek.'],
  }[view]
  const picker = (id:string) => <select id={id} className="agr-field-picker" value={active?.id??''} onChange={e=>setSelected(Number(e.target.value))} aria-label="Выбрать поле">
    {!active && <option value="">Нет полей</option>}
    {data?.fields.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
  </select>
  return <div className={`shell agr-shell ${view === 'assistant' ? 'agr-shell--assistant' : ''}`}>
    <aside className="sidebar agr-sidebar">
      <div className="brand agr-brand"><div className="brand-icon"><Leaf size={23}/></div><div><strong>AgroRadar <span>AI</span></strong><small>Аналитика сельхозполей</small></div></div>
      <div className="menu-title">НАВИГАЦИЯ</div>
      <nav aria-label="Разделы приложения" className="agr-navigation">
        {navigation.map(({id,label,Icon})=><button key={id} type="button" className={`menu agr-nav-item ${view===id?'active':''}`} aria-label={label} title={label} aria-current={view===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={19}/><span>{label}</span></button>)}
      </nav>
      <div className="agr-sidebar-meta"><div className="agr-sidebar-meta__dot"/> AgroRadar · IT-спринт<br/><span>Русагро / MVP 2.0</span></div>
    </aside>
    <main className="content agr-content">
      <header className="agr-header">
        <div><div className="eyebrow">АГРОМОНИТОРИНГ / {view==='overview'?'СВОДКА':view==='fields'?'ГЕОДАННЫЕ':'ПОМОЩНИК'}</div><h1>{pageInfo[0]}</h1><p>{pageInfo[1]}</p></div>
        <div className="agr-header-actions"><span className={`agr-source-status ${demo?'agr-source-status--demo':''}`}><span className="agr-pulse" />{data?(demo?'Демо-погода':data.degraded_count?'OpenWeather · частично недоступен':'OpenWeather · LIVE'):'Загрузка данных'}</span><button className="agr-refresh" onClick={()=>void logout()} title="Выйти из системы"><LogOut size={16}/><span>Выйти</span></button><button className="agr-refresh" onClick={()=>void refresh()} disabled={loading}><RefreshCcw size={16} className={loading?'agr-spin':''}/><span>{loading?'Обновляем…':'Обновить'}</span></button></div>
      </header>
      {error && <div className="error" role="alert">{error}. Проверь, что FastAPI запущен через START_AGRORADAR.bat.</div>}
      {data && (data.degraded_count ?? 0) > 0 && <div className="error" role="status">Погода временно недоступна для {data.degraded_count} из {data.count} полей. Контуры и данные участков сохранены. Нет данных — не означает отсутствие риска.</div>}
      {actionMessage && <div className="action-message" role="status">{actionMessage}</div>}
      {geoError && view==='fields' && <div className="error" role="alert">{geoError}. Точечные маркеры продолжат работать, если есть данные полей.</div>}

      <section className="agr-page agr-page--overview" hidden={view!=='overview'} aria-label="Сводка хозяйства">
        <div className="agr-stats">
          <div className="agr-stat"><div className="agr-stat__icon"><MapPinned size={19}/></div><span>Поля хозяйства</span><strong>{data?.count ?? '—'}</strong><small>Участков на карте</small></div>
          <div className="agr-stat"><div className="agr-stat__icon agr-stat__icon--warning"><ShieldAlert size={19}/></div><span>Высокий погодный риск</span><strong className={(data?.high_risk_count??0)>0?'agr-text-danger':''}>{data?.high_risk_count??'—'}</strong><small>По погодным факторам за 24 часа</small></div>
          <div className="agr-stat"><div className="agr-stat__icon"><Thermometer size={19}/></div><span>Температура · {active?.name??'поле'}</span><strong>{active?weatherText(active.weather.temperature_c,'°C'):'—'}</strong><small>{active?.weather.source==='demo'?'Демо-данные':'OpenWeather'}</small></div>
        </div>
        <div className="agr-overview-columns">
          <article className="agr-card agr-field-list-card">
            <div className="agr-card-heading"><div><div className="agr-overline">СОСТОЯНИЕ УЧАСТКОВ</div><h2>Поля и риски</h2></div><button className="agr-text-link" onClick={()=>navigate('fields')}>Открыть карту <ArrowRight size={16}/></button></div>
            <div className="agr-summary-strip"><CheckCircle2 size={18}/><span>{!data?'Загрузка показателей…':data.high_risk_count>0?`Есть поля с высоким погодным риском: ${data.high_risk_count}`:'По доступным погодным данным высокий риск не выявлен (проверь полноту прогноза)'}</span></div>
            <div className="agr-field-rows">{sortedFields.length===0?<div className="agr-empty">Полей пока нет. Создай первый участок на карте.</div>:sortedFields.slice(0,8).map(field=><button key={field.id} type="button" className={`agr-field-row ${active?.id===field.id?'is-selected':''}`} onClick={()=>setSelected(field.id)}>
              <span className={`agr-field-row__mark agr-risk-${field.risk.level}`} />
              <span className="agr-field-row__text"><strong>{field.name}</strong><small>{field.crop} · {field.area_ha} га</small></span>
              <span className={`agr-risk-pill agr-risk-pill--${field.risk.level}`}>{riskLabel[field.risk.level]}</span>
            </button>)}</div>
            {sortedFields.length>8&&<button className="agr-text-link agr-more-fields" onClick={()=>navigate('fields')}>Показать ещё {sortedFields.length-8} полей <ArrowRight size={15}/></button>}
          </article>
          <article className="agr-card agr-forecast-card">
            <div className="agr-card-heading"><div><div className="agr-overline">ПРОГНОЗ ДЛЯ ПОЛЯ</div><h2>{active?.name??'Выбери поле'}</h2></div>{picker('agr-overview-picker')}</div>
            {active ? <>
              <div className="agr-weather-summary">
                <div><span>Сейчас</span><strong>{weatherText(active.weather.temperature_c,'°C')}</strong></div>
                <div><span>Минимум за 24 ч</span><strong>{weatherText(active.forecast.min_temperature_next_24h_c,'°C')}</strong></div>
                <div><span>Ветер</span><strong>{weatherText(active.weather.wind_ms,'м/с')}</strong></div>
              </div>
              <TemperatureTimeline forecast={active.forecast}/>
              <div className={`agr-risk-note agr-risk-note--${active.risk.level}`}><span className={`agr-risk-pill agr-risk-pill--${active.risk.level}`}>{riskLabel[active.risk.level]}</span><p>{active.risk.reason}</p></div>
              <button className="agr-ai-link" onClick={()=>navigate('assistant')}><Bot size={17}/> Спросить ИИ об этом поле <ArrowRight size={16}/></button>
            </>:<p className="agr-empty">Выбери участок, чтобы посмотреть прогноз.</p>}
          </article>
        </div>
        <RiskDashboard fieldName={active?.name ?? 'не выбрано'} analysis={active?.risk_analysis}/>
        <details className="agr-disclosure agr-data-info"><summary><Info size={15}/> Как читать показатели <ChevronDown size={15}/></summary><p>{demo?'Погода и прогноз приведены для демонстрации.':'Погодные данные и прогноз получены от OpenWeather; это модельные данные, не датчики непосредственно на участке.'} AgroRisk Engine v2.0 оценивает заморозки, осадки, ветер и сухую жару по открытым учебным порогам. Это не подтверждённый прогноз ущерба культуре и не диагноз засухи. Отсутствующие погодные показатели помечаются как «Нет данных». Сценарии для жюри не влияют на реальные поля или контекст DeepSeek. Границы исходных полей могут быть демонстрационными.</p></details>
      </section>

      <section className="agr-page agr-page--fields" hidden={view!=='fields'} aria-label="Карта и управление полями">
        {visitedMap && <div className="agr-map-workspace">
          <section className="map-panel agr-main-map"><div className="panel-head"><h2>Карта хозяйства</h2><span>Яндекс Карты · GeoJSON</span></div><div className="map-wrap"><GeoFieldsMap fields={data?.fields??[]} geojson={geojson} activeId={active?.id} onSelect={setSelected} onSaveGeometry={saveGeometry} onCreateOutline={openCreate}/></div><div className="map-foot"><span><i className="dot green"/> Низкий</span><span><i className="dot yellow"/> Умеренный</span><span><i className="dot red"/> Высокий</span></div></section>
          <aside className="agr-map-sidebar"><div className="agr-map-sidebar__head"><h2>Участки <span>{data?.count??0}</span></h2><div className="agr-search"><Search size={15}/><input value={fieldQuery} onChange={e=>setFieldQuery(e.target.value)} placeholder="Найти поле или культуру" aria-label="Поиск поля" /></div></div>
            <div className="agr-map-field-list">{filteredFields.map(field=><button key={field.id} type="button" className={`agr-map-field ${active?.id===field.id?'is-selected':''}`} onClick={()=>setSelected(field.id)}><span className={`agr-map-field__indicator agr-risk-${field.risk.level}`}/><span><strong>{field.name}</strong><small>{field.crop} · {field.area_ha} га</small></span></button>)}{!filteredFields.length&&<div className="agr-empty">Участки не найдены.</div>}</div>
            <div className="agr-selected-card">{active?<><div className="agr-selected-card__title"><h3>{active.name}</h3><span className={`agr-risk-pill agr-risk-pill--${active.risk.level}`}>{riskLabel[active.risk.level]}</span></div>
              <p className="agr-selected-card__meta">{active.crop} · {active.area_ha} га</p>
              <div className="agr-selected-card__numbers"><span><Thermometer size={14}/> {active.weather.temperature_c} °C</span><span><Droplets size={14}/> {weatherText(active.weather.humidity_pct,'%')}</span><span><Wind size={14}/> {active.weather.wind_ms} м/с</span></div>
              <div className="agr-selected-card__actions"><button onClick={()=>openEdit(active)} disabled={busy}><Pencil size={14}/> Изменить</button><button className="agr-delete-button" onClick={()=>void deleteField(active)} disabled={busy}><Trash2 size={14}/> Удалить</button></div>
              <details className="agr-disclosure agr-field-extra" open={showFieldDetails} onToggle={e=>setShowFieldDetails(e.currentTarget.open)}><summary><span>Описание и координаты</span><ChevronDown size={15}/></summary><div className="agr-field-extra__body"><p>{active.description||'Описание ещё не добавлено.'}</p><small>{active.lat.toFixed(5)}° N, {active.lon.toFixed(5)}° E</small><small>{active.geometry_source==='user_drawn'?'Граница сохранена вручную':'Граница демонстрационная'}</small></div></details>
              <details className="agr-disclosure agr-agronomy-details"><summary><span><Leaf size={15}/> Агрономический паспорт</span><ChevronDown size={15}/></summary>
                <div className="agr-agronomy-grid">
                  <div><small>Дата посева</small><strong>{active.sowing_date || 'Не указана'}</strong></div>
                  <div><small>Фаза развития</small><strong>{active.growth_stage || 'Не указана'}</strong></div>
                  <div><small>Тип почвы</small><strong>{active.soil_type || 'Не указан'}</strong></div>
                </div>
                <p className="agr-agronomy-notice">Указано агрономом вручную. Погодные пороги v2.0 пока не калиброваны под культуру.</p>
                <button className="agr-agronomy-action" type="button" onClick={()=>openEdit(active)}><Pencil size={14}/> Заполнить паспорт</button>
              </details>
              <details className="agr-disclosure agr-agronomy-details"><summary><span><Info size={15}/> Журнал наблюдений ({active.observations?.length ?? 0})</span><ChevronDown size={15}/></summary>
                <div className="agr-observations">
                  <form onSubmit={e=>void addObservation(e)} className="agr-observations-form">
                    <label htmlFor="agr-observation-date">Дата наблюдения</label>
                    <input id="agr-observation-date" type="date" value={observationDate} onChange={e=>setObservationDate(e.target.value)} />
                    <label htmlFor="agr-observation-text">Что заметили на поле?</label>
                    <textarea id="agr-observation-text" rows={3} maxLength={1000} placeholder="Например: осмотр после дождя, состояние всходов, почва влажная на поверхности…" value={observationText} onChange={e=>setObservationText(e.target.value)}/>
                    <button type="submit" disabled={observationBusy || !observationText.trim()}>+ Добавить запись</button>
                  </form>
                  {(active.observations ?? []).length === 0 ? <p className="agr-observations-empty">Записей пока нет.</p> :
                    <div className="agr-observations-list">{[...(active.observations ?? [])].reverse().map(item=><article key={item.id} className="agr-observation-item"><div><time dateTime={item.observed_on}>{item.observed_on}</time><button type="button" aria-label={`Удалить наблюдение ${item.observed_on}`} title="Удалить наблюдение" onClick={()=>void removeObservation(active.id,item)} disabled={observationBusy}><Trash2 size={14}/></button></div><p>{item.text}</p></article>)}</div>}
                </div>
              </details>
              <button className="agr-selected-card__ask" onClick={()=>navigate('assistant')}><Bot size={16}/> Обсудить с ИИ <ArrowRight size={14}/></button>
            </>:<p className="agr-empty">Создай поле кнопкой «Новое поле» на карте.</p>}</div>
          </aside>
        </div>}
        <details className="agr-disclosure agr-geo-tools"><summary><span><SlidersHorizontal size={16}/> Дополнительные инструменты GeoJSON</span><ChevronDown size={16}/></summary><div className="agr-geo-tools__inner"><p>Импорт заменяет границу выбранного поля, экспорт сохраняет все контуры в GeoJSON. Для добавления отдельного поля нажми «Новое поле» на карте.</p><div className="gis-actions"><label className="file-btn">↑ Импорт контура<input type="file" accept=".json,.geojson,application/geo+json" onChange={e=>void importGeoJSON(e)} hidden/></label><button type="button" onClick={exportGeoJSON} disabled={!geojson}>↓ Экспорт GeoJSON</button>{active?.kind==='demo' && active?.geometry_source==='user_drawn' && <button type="button" className="outline-danger" onClick={()=>void resetGeometry(active.id)}>Сбросить контур</button>}</div></div></details>
      </section>

      <section className="agr-page agr-page--ai" hidden={view!=='assistant'} aria-label="ИИ-агроном">
        <div className="agr-ai-context-switch"><div><span>ПОЛЕ ДЛЯ АНАЛИЗА</span><strong>{active?.crop??'Нет культуры'}</strong></div>{picker('agr-assistant-picker')}<button className="agr-text-link" onClick={()=>navigate('fields')}><MapPinned size={15}/> На карте</button></div>
        {visitedAi && <AiAgronom key={active?.id ?? 0} field={active}/>}
      </section>
      <footer className="agr-footer">AgroRadar AI · Конкурсный прототип · Карта: Яндекс Карты · Данные исходных участков могут быть демонстрационными</footer>
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
            <div className="agr-agronomy-form-divider"><Leaf size={16}/> Агрономический паспорт <span>необязательно</span></div>
            <label htmlFor="field-sowing-input">Дата посева</label>
            <input id="field-sowing-input" type="date" value={form.sowing_date} onChange={e=>setForm(prev=>({...prev,sowing_date:e.target.value}))}/>
            <label htmlFor="field-stage-input">Фаза развития культуры</label>
            <input id="field-stage-input" maxLength={100} value={form.growth_stage} onChange={e=>setForm(prev=>({...prev,growth_stage:e.target.value}))} placeholder="Например, кущение или 4 листа" list="agro-stages" />
            <datalist id="agro-stages"><option value="Всходы"/><option value="Кущение"/><option value="Выход в трубку"/><option value="Колошение"/><option value="Цветение"/><option value="Созревание"/></datalist>
            <label htmlFor="field-soil-input">Тип почвы</label>
            <input id="field-soil-input" maxLength={100} value={form.soil_type} onChange={e=>setForm(prev=>({...prev,soil_type:e.target.value}))} placeholder="Например, чернозём типичный" list="agro-soils" />
            <datalist id="agro-soils"><option value="Чернозём"/><option value="Суглинок"/><option value="Супесь"/><option value="Песчаная почва"/><option value="Глинистая почва"/></datalist>
            <label htmlFor="field-description-input">Описание / заметки</label>
            <textarea id="field-description-input" rows={4} maxLength={2000} value={form.description} onChange={e=>setForm(prev=>({...prev,description:e.target.value}))} placeholder="Например, сорт, особенности участка, планируемые работы…" />
            {dialog.mode==='create' && <div className="field-modal__hint">Вершин контура: {dialog.outline?.length ?? 0}. Площадь и центр автоматически определит сервер.</div>}
            {formError && <div className="field-modal__error" role="alert">{formError}</div>}
            <div className="field-modal__footer"><button type="button" className="field-modal__cancel" onClick={()=>setDialog(null)} disabled={busy}>Отмена</button>
              <button type="submit" disabled={busy}><Save size={16}/>{busy?'Сохранение…':dialog.mode==='create'?'Создать поле':'Сохранить изменения'}</button></div>
          </form>
        </div>
      </div>}
    </main>
  </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate><App/></AuthGate></React.StrictMode>)
