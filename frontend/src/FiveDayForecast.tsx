import { useEffect, useState } from 'react'
import { apiFetch } from './authClient'
import './FiveDayForecast.css'

type Level = 'high' | 'medium' | 'low' | 'unknown'

type ForecastDay = {
  day: number
  start: string
  end: string
  sample_count: number
  min_temperature_c: number | null
  max_temperature_c: number | null
  precipitation_mm: number | null
  risk: { level: Level; label: string; reason: string }
  assessments: { id: string; title: string; label: string; level: Level; reason: string }[]
  unknown_count: number
  data_quality: { status: string }
}

export type FiveDayData = {
  source: string
  issued_at: string
  interval_hours: number
  days: ForecastDay[]
  notice: string
}

type ArchiveEntry = {
  date: string
  recorded_at: string
  source: string
  current_temperature_c: number | null
  forecast: FiveDayData
}

const dateTime = (iso: string) => new Date(iso).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
})
const number = (value: number | null, unit: string) =>
  value === null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${unit}`

export default function FiveDayForecast({
  fieldId, forecast,
}: {
  fieldId: number | null
  forecast?: FiveDayData
}) {
  const [archive, setArchive] = useState<ArchiveEntry[]>([])
  const [chosen, setChosen] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setChosen('')
    setArchive([])
    setError('')
    if (!fieldId) return
    const controller = new AbortController()
    setLoading(true)
    apiFetch(`/api/operations/fields/${fieldId}/forecast-archive?limit=30`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Ошибка чтения истории: ${response.status}`)
        return response.json() as Promise<{ entries: ArchiveEntry[] }>
      })
      .then(payload => {
        if (!controller.signal.aborted) setArchive(Array.isArray(payload.entries) ? payload.entries : [])
      })
      .catch(err => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Архив недоступен')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [fieldId, forecast?.issued_at])

  const selectedArchive = archive.find(item => item.date === chosen)
  const current = selectedArchive?.forecast ?? forecast
  const isDemo = current?.source === 'demo'
  return <section className="agr-five-day" aria-label="Прогноз рисков на пять суток и архив">
    <header className="agr-five-day__header">
      <div>
        <div className="agr-overline">ПЯТЬ СУТОК · ОТДЕЛЬНЫЙ РАСЧЁТ РИСКА НА КАЖДЫЕ 24 ЧАСА</div>
        <h2>Прогноз на пять дней</h2>
        <p>Погодные интервалы по три часа. Отдельная оценка заморозков, осадков, ветра и сухой жары для каждого дня.</p>
      </div>
      <label className="agr-five-day__selector">
        <span>Снимок прогноза</span>
        <select value={chosen} onChange={event => setChosen(event.target.value)} disabled={!fieldId}>
          <option value="">Текущий прогноз</option>
          {archive.map(entry =>
            <option key={entry.date} value={entry.date}>
              Сохранён {new Date(entry.recorded_at).toLocaleString('ru-RU')}
            </option>,
          )}
        </select>
      </label>
    </header>
    {!fieldId && <p>Выбери поле, чтобы увидеть прогноз.</p>}
    {fieldId && loading && <p className="agr-five-day__hint">Читаем архив из базы данных…</p>}
    {error && <p className="agr-five-day__error" role="alert">{error}. Сам текущий прогноз остаётся доступен.</p>}
    {selectedArchive && <p className="agr-five-day__hint">
      Показан сохранённый ${dateTime(selectedArchive.recorded_at)} прогноз, а не фактическая погода за прошедшие дни.
    </p>}
    {isDemo && <p className="agr-five-day__hint">ДЕМО: синтетический прогноз. Он не архивируется как реальная погода.</p>}
    {current && <div className="agr-five-day__grid">
      {current.days.map(day => {
        const raised = day.assessments.filter(item => item.level === 'high' || item.level === 'medium')
        return <article key={day.day} className={`agr-five-day__card agr-five-day__card--${day.risk.level}`}>
          <div className="agr-five-day__date"><strong>День {day.day}</strong><span>{dateTime(day.start)} — {dateTime(day.end)}</span></div>
          <span className={`agr-risk-pill agr-risk-pill--${day.risk.level}`}>{day.risk.label}</span>
          <div className="agr-five-day__metrics">
            <span>Мин.: <b>{number(day.min_temperature_c, '°C')}</b></span>
            <span>Макс.: <b>{number(day.max_temperature_c, '°C')}</b></span>
            <span>Осадки: <b>{number(day.precipitation_mm, 'мм')}</b></span>
            <span>Точек: <b>{day.sample_count}</b></span>
          </div>
          {day.unknown_count > 0 && <p className="agr-five-day__incomplete">Неполные данные: {day.unknown_count} из 4 факторов без оценки.</p>}
          {raised.length > 0 && <details><summary>Почему такой риск?</summary>
            <ul>{raised.map(item => <li key={item.id}><b>{item.title}:</b> {item.reason}</li>)}</ul>
          </details>}
          {!day.sample_count && <p className="agr-five-day__incomplete">Прогноз для этого периода отсутствует.</p>}
        </article>
      })}
    </div>}
    {current && <p className="agr-five-day__disclaimer">{current.notice}</p>}
    <p className="agr-five-day__hint">
      {archive.length
        ? `Архив: ${archive.length} дневных снимков. При открытии сводки последний живой прогноз за день обновляется.`
        : 'Архив пока пуст. Живые прогнозы OpenWeather начнут сохраняться при открытии сводки; прошлые дни задним числом не восстанавливаются.'}
      {' '}Срок хранения — до 45 дней.
    </p>
  </section>
}
