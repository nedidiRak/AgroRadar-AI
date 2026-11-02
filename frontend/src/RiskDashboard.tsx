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
    fetch(`/api/risks/scenarios/${scenario}`, { signal: controller.signal })
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
        <span className="agr-risk-engine__eyebrow">AGRORISK ENGINE · ПРАВИЛА V2.0</span>
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
      <p className="agr-risk-engine__disclaimer"><Info size={15}/>{current.disclaimer}</p>
    </>}
  </section>
}
