import { apiFetch } from './authClient'
import { useEffect, useState } from 'react'
import { AlertTriangle, CloudRain, Flame, Info, Snowflake, Wind } from 'lucide-react'
import './RiskDashboard.css'

type Level = 'high' | 'medium' | 'low' | 'unknown'
export type RiskAssessment = {
  id: 'frost' | 'rain' | 'wind' | 'dry_heat'
  title: string
  level: Level
  label: string
  value: number | null
  unit: string
  reason: string
  rule: string
  next_step: string
  data_source: string
  coverage?: string
}
type DataQuality = {
  status: 'available' | 'partial' | 'demo' | 'simulation' | 'unavailable'
  label: string
  source: string
  forecast_points: number
  expected_interval_hours: number
  known_factors: number
  unknown_factors: number
  factor_coverage_complete: boolean
  limitations: string[]
  note: string
}
type FieldContext = {
  crop: string | null
  growth_stage: string | null
  soil_type: string | null
  sowing_date: string | null
  observation_count: number
  source: string
  missing: string[]
  interpretation: string
}
type PriorityAction = {
  id: string
  level: Level
  title: string
  why: string
  action: string
  evidence: string
  basis: string
}
export type RiskAnalysis = {
  version: string
  source: string
  period_hours: number
  overall: { level: Level; label: string; reason: string }
  assessments: RiskAssessment[]
  known_count: number
  unknown_count: number
  disclaimer: string
  is_simulation: boolean
  coverage_complete?: boolean
  data_quality?: DataQuality
  field_context?: FieldContext
  priority_actions?: PriorityAction[]
  decision_support_notice?: string
}
type Scenario = 'live' | 'frost' | 'rain' | 'wind' | 'dry_heat'
type Simulation = { scenario: string; title: string; subtitle: string; analysis: RiskAnalysis; notice: string }

const scenarios: { key: Scenario; label: string }[] = [
  { key: 'live', label: 'Данные выбранного поля' },
  { key: 'frost', label: 'Сценарий: заморозок' },
  { key: 'rain', label: 'Сценарий: ливень' },
  { key: 'wind', label: 'Сценарий: сильный ветер' },
  { key: 'dry_heat', label: 'Сценарий: сухая жара' },
]
const icons = { frost: Snowflake, rain: CloudRain, wind: Wind, dry_heat: Flame }

export default function RiskDashboard({ fieldName, analysis }: {fieldName: string; analysis?: RiskAnalysis}) {
  const [scenario, setScenario] = useState<Scenario>('live')
  const [simulation, setSimulation] = useState<Simulation | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (scenario === 'live') {
      setSimulation(null)
      setError('')
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setSimulation(null)
    setError('')
    apiFetch(`/api/risks/scenarios/${scenario}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Сценарий недоступен: HTTP ${response.status}`)
        return response.json() as Promise<Simulation>
      })
      .then(data => { if (!controller.signal.aborted) setSimulation(data) })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Ошибка загрузки сценария') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [scenario])

  const current = scenario === 'live' ? analysis : simulation?.analysis
  const demo = scenario !== 'live'
  return <section className="agr-risk-engine" aria-label="Анализ погодных рисков">
    <div className="agr-risk-engine__header">
      <div>
        <span className="agr-risk-engine__eyebrow">AGRORISK ENGINE · V3.0</span>
        <h2>Погодные риски на 24 часа</h2>
        <p>{demo ? 'Изолированная демонстрация алгоритмов' : `По прогнозу для поля «${fieldName}»`}</p>
      </div>
      <label className="agr-risk-engine__selector">
        <span>Режим анализа</span>
        <select value={scenario} onChange={e => setScenario(e.target.value as Scenario)} aria-label="Режим демонстрации риска">
          {scenarios.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
    </div>
    {demo && <div className="agr-risk-engine__simulation" role="status"><AlertTriangle size={18}/>
      <span><strong>СИМУЛЯЦИЯ · НЕ РЕАЛЬНАЯ ПОГОДА.</strong> {simulation?.subtitle || 'Загружаем учебный сценарий.'} Данные существующих полей и ИИ-агронома не изменяются.</span>
      <button type="button" onClick={() => setScenario('live')}>Вернуться к прогнозу</button>
    </div>}
    {!demo && current?.source === 'demo' && <div className="agr-risk-engine__demodata">Демонстрационная погода. Для реальных предупреждений подключи OpenWeather.</div>}
    {error && <div className="agr-risk-engine__error" role="alert">{error}</div>}
    {!current && <div className="agr-risk-engine__placeholder">{loading ? 'Рассчитываем демонстрационные риски…' : 'Ожидаем данные для анализа.'}</div>}
    {current && <>
      <div className="agr-risk-engine__summary">
        <span className={`agr-risk-engine__overall agr-risk-engine__overall--${current.overall.level}`}>{current.overall.label}</span>
        <span>{current.overall.reason}</span>
      </div>
      {current.data_quality && <div className="agr-risk-engine__quality" aria-label="Качество входных данных">
        <div className="agr-risk-engine__quality-main">
          <strong>Качество входных данных</strong>
          <span className={`agr-risk-engine__quality-status agr-risk-engine__quality-status--${current.data_quality.status}`}>{current.data_quality.label}</span>
        </div>
        <div className="agr-risk-engine__quality-metrics">
          <span>Оценено факторов: <b>{current.data_quality.known_factors}/4</b></span>
          <span>Точек прогноза: <b>{current.data_quality.forecast_points}</b> · шаг 3 часа</span>
          <span>Источник: <b>{current.data_quality.source}</b></span>
        </div>
        <ul>{current.data_quality.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul>
        <small>{current.data_quality.note}</small>
      </div>}
      <div className="agr-risk-engine__grid">
        {current.assessments.map(item => {
          const Icon = icons[item.id] || Info
          return <article key={item.id} className={`agr-risk-card agr-risk-card--${item.level}`}>
            <div className="agr-risk-card__top"><span className="agr-risk-card__icon"><Icon size={19}/></span><span className={`agr-risk-card__level agr-risk-card__level--${item.level}`}>{item.label}</span></div>
            <h3>{item.title}</h3>
            <p className="agr-risk-card__metric">{item.value === null ? '—' : `${item.value.toLocaleString('ru-RU')} ${item.unit}`}</p>
            <p className="agr-risk-card__explanation">{item.reason}</p>
            <details><summary>Почему такой уровень?</summary>
              <p><strong>Правило:</strong> {item.rule}</p>
              <p><strong>Следующий шаг:</strong> {item.next_step}</p>
              {item.coverage && <p className="agr-risk-card__coverage">{item.coverage}</p>}
            </details>
          </article>
        })}
      </div>
      {current.priority_actions && <div className="agr-risk-engine__decisions">
        <div className="agr-risk-engine__decisions-title"><h3>Приоритетные действия агронома</h3><span>По обнаруженным погодным факторам</span></div>
        <div className="agr-risk-engine__actions">
          {current.priority_actions.map((item,index)=><article className={`agr-risk-action agr-risk-action--${item.level}`} key={item.id}>
            <div className="agr-risk-action__top"><span className="agr-risk-action__number">{index+1}</span><strong>{item.title}</strong></div>
            <p>{item.action}</p>
            <details><summary>Основание и проверка</summary><p>{item.why}</p><small>{item.evidence}</small></details>
          </article>)}
        </div>
      </div>}
      {!demo && current.field_context && <div className="agr-risk-engine__field-context">
        <strong>Контекст выбранного поля · сведения пользователя</strong>
        <div><span>Культура: {current.field_context.crop || 'не указана'}</span><span>Фаза: {current.field_context.growth_stage || 'не указана'}</span><span>Почва: {current.field_context.soil_type || 'не указана'}</span><span>Наблюдения: {current.field_context.observation_count}</span></div>
        {!!current.field_context.missing.length && <p>Для уточнения оценки заполни: {current.field_context.missing.join(', ').toLowerCase()}.</p>}
        <small>{current.field_context.interpretation}</small>
      </div>}
      {current.decision_support_notice && <p className="agr-risk-engine__decision-notice">{current.decision_support_notice}</p>}
      <p className="agr-risk-engine__disclaimer"><Info size={15}/>{current.disclaimer}</p>
    </>}
  </section>
}
