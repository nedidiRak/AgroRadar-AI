import { useLayoutEffect, useRef, useState } from 'react'

export type Sample = { id: number; value: number; label: string; title: string; color?: string }

export function TemperaturePlot({ points, minimum, padding = 1, label }: {
  points: Sample[]; minimum?: number | null; padding?: number; label: string
}) {
  const plot = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ width: 320, height: 150, labelWidth: 36, lineHeight: 16 })
  useLayoutEffect(() => {
    const box = plot.current!, text = probe.current!
    function measure() {
      const { width, height } = box.getBoundingClientRect()
      if (!width || !height) return
      const rect = text.getBoundingClientRect()
      const next = { width, height, labelWidth: rect.width, lineHeight: rect.height }
      setSize(prev => prev.width === width && prev.height === height &&
        prev.labelWidth === rect.width && prev.lineHeight === rect.height ? prev : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    observer.observe(text)
    return () => observer.disconnect()
  }, [])

  if (!points.length) return null
  const { width, height, labelWidth, lineHeight } = size
  const high = Math.max(...points.map(p => p.value), minimum ?? -Infinity) + padding
  const low = Math.min(...points.map(p => p.value), minimum ?? Infinity) - padding
  // Temperature labels live left of the plotting area. Time labels have their own bottom band.
  const left = Math.ceil(lineHeight * 3.1)
  const right = Math.max(left + 1, width - 7)
  const top = lineHeight / 2 + 3
  const bottom = Math.max(top + 1, height - lineHeight - 12)
  const x = (i: number) => points.length === 1 ? (left + right) / 2 : left + (right - left) * i / (points.length - 1)
  const y = (v: number) => top + (high - v) / (high - low) * (bottom - top)
  const path = points.map((p, i) => (i ? 'L' : 'M') + x(i) + ' ' + y(p.value)).join(' ')
  const capacity = Math.max(1, Math.floor((right - left) / (labelWidth + 12)))
  const count = Math.min(points.length, capacity)
  const candidates = Array.from({ length: count }, (_, i) => Math.round(i * (points.length - 1) / Math.max(1, count - 1)))
  let lastEnd = left + labelWidth
  const ticks = candidates.filter((index, i) => {
    if (i === 0 || i === count - 1) return true
    const start = x(index) - labelWidth / 2
    const end = start + labelWidth
    if (start < lastEnd + 6 || end + 6 > right - labelWidth) return false
    lastEnd = end
    return true
  })
  const yTicks: number[] = []
  for (const value of [0, Math.floor(high), Math.ceil(low)]) {
    if (value >= low && value <= high && yTicks.every(old => Math.abs(y(old) - y(value)) > lineHeight + 3)) yTicks.push(value)
  }
  return <div className="temperature-plot" ref={plot}>
    <span aria-hidden="true" ref={probe} className="plot-probe">{points.reduce((a,b) => a.label.length >= b.label.length ? a : b).label}</span>
    <svg className="timeline-chart" role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`}>
      {yTicks.map(value => <g key={value}>
        <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke={value === 0 ? '#e6c176' : '#385a4a'} strokeDasharray="4 4"/>
        <text data-axis="temperature" x={left - 7} y={y(value)} dominantBaseline="central" textAnchor="end" fill={value === 0 ? '#e6c176' : '#95b5a5'}>{value}°C</text>
      </g>)}
      <path d={path} fill="none" stroke="#72e1b4" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      {points.map((p,i) => <circle key={p.id} cx={x(i)} cy={y(p.value)} r={points.length > 16 ? 2.5 : 4} stroke="#113c2e" strokeWidth="1.5" fill={p.color ?? (p.value <= 0 ? '#fb817b' : '#72e1b4')}>
        <title>{p.title}</title></circle>)}
      {ticks.map((index, i) => <text key={index} data-axis="time"
        x={count === 1 ? (left + right) / 2 : x(index)} y={height - lineHeight / 2 - 2} dominantBaseline="central"
        textAnchor={count === 1 ? 'middle' : i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
        fill="#95b5a5">{points[index].label}</text>)}
    </svg>
  </div>
}

type ForecastPoint = {timestamp:number;temperature_c:number;precipitation_probability_pct:number|null;rain_mm_3h:number|null}
export type Forecast = {min_temperature_next_24h_c:number|null;source:string;sample_count:number;period_hours:number;points?:ForecastPoint[]}
const time = (stamp:number) => new Date(stamp * 1000).toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'})

export function TemperatureTimeline({ forecast, part = 'both' }: {
  forecast: Forecast; part?: 'chart' | 'hourly' | 'both'
}) {
  const points = (forecast.points ?? []).slice(0, 9)
  if (!points.length) return <div className="timeline-empty">Нет данных по временным точкам прогноза.</div>
  const demo = forecast.source === 'demo'
  return <section className="forecast-timeline" aria-label={part === 'hourly' ? 'Почасовой прогноз' : 'Прогноз температуры на 24 часа'}>
    <div className="timeline-header"><div><strong>{part === 'hourly' ? 'Почасовой прогноз' : 'Температура на 24 часа'}</strong><span>Шаг прогноза — 3 часа</span></div>
      <span className={demo ? 'timeline-demo' : 'timeline-live'}>{demo ? 'ДЕМО · НЕ РЕАЛЬНЫЙ ПРОГНОЗ' : 'OPENWEATHER · ПРОГНОЗ'}</span></div>
    {part !== 'hourly' && <TemperaturePlot label="График температуры по временным точкам" minimum={forecast.min_temperature_next_24h_c}
      points={points.map(p => ({ id:p.timestamp, value:p.temperature_c, label:time(p.timestamp),
        title:`${time(p.timestamp)} · ${p.temperature_c} °C${p.precipitation_probability_pct == null ? '' : ', осадки ' + p.precipitation_probability_pct + '%'}` }))}/>}
    <div className="timeline-legend" aria-label="Обозначения прогноза"><span>°C — температура воздуха</span>{part !== 'chart' && <span>☔ % — вероятность осадков</span>}</div>
    {part !== 'chart' && <div className="timeline-data">{points.map(p => <div key={p.timestamp}>
      <small>{time(p.timestamp)}</small><strong>{p.temperature_c > 0 ? '+' : ''}{p.temperature_c}°</strong>
      <span title={p.precipitation_probability_pct === null ? 'Нет данных о вероятности осадков' : 'Вероятность осадков'}>{p.precipitation_probability_pct === null ? '—' : `☔ ${p.precipitation_probability_pct}%`}</span>
    </div>)}</div>}
    <p className="timeline-disclaimer">Значения — прогнозные точки модели. Минимум риска рассчитан по температурным минимумам 3-часовых интервалов.</p>
  </section>
}
