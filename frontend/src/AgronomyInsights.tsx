import { useEffect, useState } from 'react'
import { BookOpen, ChevronDown, CloudRain, Droplets, Leaf, RefreshCcw } from 'lucide-react'
import { apiFetch } from './authClient'
import './AgronomyInsights.css'

type Source={title:string;url:string}
type Disease={
  status:string;label:string;title:string;explanation:string;action:string
  limitations:string[];sources:Source[];matched_intervals:number
}
type Water={
  status:string;label:string;explanation?:string;limitation:string
  precipitation_7d_mm:number|null;et0_7d_mm:number|null;p_minus_et0_mm:number|null
  period_start:string|null;period_end:string|null;days:number;sources:Source[]
}
type Analysis={
  field_name:string;crop:string;forecast_source:string;phytosanitary:Disease
  water_context:Water;disclaimer:string
}
export default function AgronomyInsights({fieldId}:{fieldId:number|null}) {
  const [expanded,setExpanded]=useState(false)
  const [analysis,setAnalysis]=useState<Analysis|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [revision,setRevision]=useState(0)

  useEffect(()=>{
    if(!expanded||!fieldId){setAnalysis(null);return}
    const ctrl=new AbortController()
    setBusy(true);setError('');setAnalysis(null)
    apiFetch('/api/fields/'+fieldId+'/agronomy',{signal:ctrl.signal})
      .then(async response=>{
        if(!response.ok)throw new Error('Ошибка анализа поля: HTTP '+response.status)
        return response.json() as Promise<Analysis>
      })
      .then(data=>{if(!ctrl.signal.aborted)setAnalysis(data)})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Аналитика недоступна')})
      .finally(()=>{if(!ctrl.signal.aborted)setBusy(false)})
    return ()=>ctrl.abort()
  },[fieldId,expanded,revision])

  const rust=analysis?.phytosanitary
  const water=analysis?.water_context
  return <section className="agr-v4" aria-label="Агрономическая аналитика 4.0">
    <button className="agr-v4-toggle" type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>
      <span><Leaf size={20}/><span><strong>Агрономическая аналитика 4.0</strong>
        <small>Научные источники · наблюдение за болезнями · водный баланс</small></span></span>
      <ChevronDown size={18} className={expanded?'agr-v4-open':''}/>
    </button>
    {expanded&&<div className="agr-v4-content">
      <div className="agr-v4-info">Дополнительные расчёты выполняются только для выбранного поля. Осадки и ET₀ — модельные данные Open-Meteo, а не датчик на участке.</div>
      {busy&&<p className="agr-v4-loading">Проверяем доступные прогнозные данные…</p>}
      {error&&<p className="agr-v4-error" role="alert">{error}
        <button type="button" onClick={()=>setRevision(v=>v+1)}><RefreshCcw size={14}/> Повторить</button></p>}
      {analysis&&<>
        <article className="agr-v4-card">
          <div className="agr-v4-card-heading"><BookOpen size={19}/><h3>Погодные предпосылки болезней</h3></div>
          {rust&&<>
            <p className="agr-v4-label">{rust.title} <span data-status={rust.status}>{rust.label}</span></p>
            <p>{rust.explanation}</p>
            {rust.status==='watch'&&<p className="agr-v4-action"><strong>Что проверить:</strong> {rust.action}</p>}
            <details><summary>Ограничения и первоисточники</summary>
              <ul>{rust.limitations.map((note,i)=><li key={i}>{note}</li>)}</ul>
              {rust.sources.map(src=><a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a>)}
            </details>
          </>}
        </article>
        <article className="agr-v4-card">
          <div className="agr-v4-card-heading"><Droplets size={19}/><h3>Атмосферный водный баланс</h3></div>
          {water&&<>
            <p className="agr-v4-muted">{water.label}{water.period_start&&water.period_end&&
              ' · '+water.period_start+' — '+water.period_end}</p>
            {water.status==='available'&&<div className="agr-v4-metrics">
              <div><span>Осадки за 7 дней</span><strong>{water.precipitation_7d_mm} мм</strong></div>
              <div><span>Эталонная ET₀</span><strong>{water.et0_7d_mm} мм</strong></div>
              <div><span>Осадки − ET₀</span><strong>{water.p_minus_et0_mm} мм</strong></div>
            </div>}
            <p>{water.explanation??water.limitation}</p>
            <details><summary>Что означает ET₀ и откуда данные?</summary>
              <p>{water.limitation}</p>
              {water.sources.map(src=><a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a>)}
            </details>
          </>}
        </article>
        <p className="agr-v4-disclaimer"><CloudRain size={16}/> {analysis.disclaimer}
          Для коммерческого использования Open-Meteo необходимо проверить условия лицензии.</p>
      </>}
    </div>}
  </section>
}
