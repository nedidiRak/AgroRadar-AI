import type { ReactNode } from 'react'
import './CropRiskPanel.css'

type Level = 'medium' | 'unknown'
type ResearchAssessment = {
  rule_id: string
  factor: string
  level: Level
  title: string
  stage_code: string
  measurement_type: string
  value: number | null
  threshold: {operator: string | null; value: number | null; min: number | null; max: number | null; unit: string}
  evidence_class: string
  review_status: string
  confidence: string
  source_urls: string[]
  reason: string
  limitations: string
}
export type CropRiskAnalysis = {
  version: string
  ruleset_version: string
  crop_id: string | null
  crop_name: string | null
  stage_code: string | null
  stage_label?: string | null
  source: string
  simulated: boolean
  overall: {level: Level; label: string}
  reason: string
  assessments: ResearchAssessment[]
  approved_rules: number
  disclaimer: string
}

export default function CropRiskPanel({analysis, children}: {analysis?: CropRiskAnalysis;children?: ReactNode}) {
  return <section className="agr-crop-risk" aria-label="Научный анализ для культуры">
    <header className="agr-crop-risk__header">
      <div>
        <span className="agr-overline">AGRORISK · НАУЧНЫЙ СЛОЙ · ЭКСПЕРИМЕНТАЛЬНО</span>
        <h2>Риски с учётом культуры</h2>
        <p>Второй слой: не изменяет старые четыре погодных показателя и цвет поля на карте.</p>
      </div>
      <span className={`agr-crop-risk__pill agr-crop-risk__pill--${analysis?.overall.level ?? 'unknown'}`}>
        {analysis?.overall.label ?? 'Недостаточно данных'}
      </span>
    </header>
    <div className="agr-crop-risk__profile">
      <span>Культура: <strong>{analysis?.crop_name || 'не выбрана из справочника'}</strong></span>
      <span>Стадия: <strong>{analysis?.stage_label || 'не указана'}</strong></span>
      <span>Версия: <strong>{analysis?.ruleset_version || '—'}</strong></span>
    </div>
    {analysis?.simulated && <p className="agr-crop-risk__notice">Демонстрационная погода: предупреждения не относятся к реальным полям.</p>}
    <p className="agr-crop-risk__reason">{analysis?.reason || 'Загрузка исследовательских данных…'}</p>
    {analysis?.assessments.map(item => <article className={`agr-crop-risk__item agr-crop-risk__item--${item.level}`} key={item.rule_id}>
      <div className="agr-crop-risk__top">
        <strong>{({heat:"Тепловой стресс",frost:"Заморозки",chilling:"Холодовая нагрузка",temperature:"Температура",freeze:"Вымерзание",heat_dose:"Тепловая доза",heat_dry:"Жара и сухая почва",heat_long_exposure:"Длительная жара",water_demand_parameter:"Водный коэффициент",disease_weather_screen:"Погодный риск болезни"} as Record<string,string>)[item.factor] || item.factor} · {item.title}</strong>
        <span>{item.level === 'medium' ? 'Требует внимания' : 'Недостаточно данных'}</span>
      </div>
      <p>{item.reason}</p>
      <details>
        <summary>Научное основание и ограничения</summary>
        <p><strong>Правило:</strong> {item.rule_id}; {item.measurement_type}; {item.threshold.operator ?? 'ориентир'} {item.threshold.value ?? ([item.threshold.min, item.threshold.max].filter(x => x !== null).join('…') || 'не задано')} {item.threshold.unit}</p>
        <p><strong>Источник доказательств:</strong> {item.evidence_class} · {item.confidence}, статус: {item.review_status}</p>
        <p>{item.limitations}</p>
        {item.source_urls.map(url => <p key={url}><a href={url} target="_blank" rel="noreferrer noopener">Открыть исследование</a></p>)}
      </details>
    </article>)}
    {children}
    <p className="agr-crop-risk__disclaimer">{analysis?.disclaimer || 'Каталог является исследовательским, не медицинским или финансовым прогнозом.'}</p>
  </section>
}
