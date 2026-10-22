import { useEffect, useRef, useState } from 'react'
import { Bot, Leaf, RotateCcw, Send, Sparkles, ShieldCheck } from 'lucide-react'
import './AiAgronom.css'

type RiskLevel = 'high' | 'medium' | 'low'
type FieldContext = {
  id: number
  name: string
  crop: string
  description?: string
  area_ha: number
  risk: { level: RiskLevel; label: string }
  weather: { source: string; temperature_c: number }
  forecast: { source: string; min_temperature_next_24h_c: number }
}
type Message = { role: 'user' | 'assistant'; content: string }
type AiStatus = { configured: boolean; model: string; provider: string }
type ChatResult = {
  answer: string
  model: string
  weather_source: string
  knowledge_ids: string[]
  usage?: { total_tokens?: number | null }
}

const suggested = [
  'Оцени погодные риски на 24 часа и объясни причины.',
  'Что проверить агроному на этом поле сегодня?',
  'Какую информацию о культуре нужно собрать для точной оценки?',
  'Составь краткую сводку для руководителя хозяйства.',
]

function apiError(data: unknown, status: number) {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
  }
  return `Ошибка сервера HTTP ${status}`
}

export default function AiAgronom({ field }: { field?: FieldContext }) {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let mounted = true
    fetch('/api/ai/status')
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<AiStatus>
      })
      .then(data => { if (mounted) setStatus(data) })
      .catch(() => { if (mounted) setStatusError('Не удалось проверить ИИ-сервис. Проверь запуск FastAPI.') })
    return () => { mounted = false }
  }, [])
  useEffect(() => { if (messages.length || busy) { const node = messagesRef.current; if (node) node.scrollTop = node.scrollHeight } }, [messages, busy])

  async function send(text: string) {
    const question = text.trim()
    if (!question || !field || busy || !status?.configured) return
    const history = messages.slice(-10)
    setMessages([...messages, { role: 'user', content: question }])
    setPrompt('')
    setError('')
    setBusy(true)
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_id: field.id, message: question, history }),
      })
      const data: ChatResult & { detail?: string } = await response.json().catch(() => ({} as ChatResult))
      if (!response.ok) throw new Error(apiError(data, response.status))
      if (!data.answer) throw new Error('Пустой ответ ИИ-сервиса')
      setMessages(previous => [...previous, { role: 'assistant', content: data.answer }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить ответ DeepSeek')
    } finally {
      setBusy(false)
    }
  }

  const live = field?.weather.source === 'openweather_current'
  return <section className="agro-ai" id="ai-assistant" aria-labelledby="agro-ai-title">
    <div className="agro-ai__heading">
      <div className="agro-ai__brand">
        <span className="agro-ai__logo"><Bot size={24} /></span>
        <div>
          <div className="agro-ai__kicker"><Sparkles size={13} /> ИНТЕЛЛЕКТУАЛЬНЫЙ ПОМОЩНИК</div>
          <h2 id="agro-ai-title">ИИ-агроном <span>AgroRadar</span></h2>
          <p>Анализ выбранного поля, прогноза и температурных рисков с помощью DeepSeek</p>
        </div>
      </div>
      <div className="agro-ai__status">
        <span className={`agro-ai__signal ${status?.configured ? 'agro-ai__signal--online' : ''}`} />
        {status ? status.configured ? 'DeepSeek подключён' : 'Требуется API-ключ' : statusError || 'Проверка подключения…'}
      </div>
    </div>

    <div className="agro-ai__layout">
      <aside className="agro-ai__context">
        <div className="agro-ai__context-title"><Leaf size={17}/> КОНТЕКСТ ДЛЯ АНАЛИЗА</div>
        {field ? <>
          <strong className="agro-ai__field-name">{field.name}</strong>
          <p className="agro-ai__crop">{field.crop} · {field.area_ha} га</p>
          <div className="agro-ai__metric"><span>Температура сейчас</span><b>{field.weather.temperature_c} °C</b></div>
          <div className="agro-ai__metric"><span>Минимум за 24 часа</span><b>{field.forecast.min_temperature_next_24h_c} °C</b></div>
          <div className="agro-ai__metric"><span>Температурный риск</span><b className={`agro-ai__risk--${field.risk.level}`}>{field.risk.label}</b></div>
          <div className="agro-ai__data-source">{live ? '● OpenWeather LIVE' : '◌ Демо-погода'}<br/>+ локальные справочные заметки</div>
        </> : <p>Сначала выбери или создай поле.</p>}
        <div className="agro-ai__notice"><ShieldCheck size={16}/> Советы ИИ не заменяют проверку на месте. Данных о влажности почвы и фазе развития пока нет.</div>
      </aside>

      <div className="agro-ai__chat">
        <div className="agro-ai__chat-top"><span>Диалог об участке</span><button type="button" className="agro-ai__clear" onClick={() => { setMessages([]); setError('') }} disabled={busy || messages.length === 0}><RotateCcw size={14}/> Новый диалог</button></div>
        <div className="agro-ai__messages" ref={messagesRef} aria-live="polite">
          {messages.length === 0 && <div className="agro-ai__welcome">
            <div className="agro-ai__welcome-icon"><Sparkles size={27}/></div>
            <strong>С чего начнём анализ?</strong>
            <p>Я учитываю текущие данные выбранного поля, прогноз OpenWeather и общие справочные заметки. Выбери вопрос или напиши свой.</p>
            <div className="agro-ai__suggestions">{suggested.map(item => <button key={item} type="button" onClick={() => void send(item)} disabled={!status?.configured || !field || busy}>{item}</button>)}</div>
          </div>}
          {messages.map((message, index) => <div key={`${index}-${message.role}`} className={`agro-ai__message agro-ai__message--${message.role}`}><span>{message.role === 'assistant' ? 'ИИ-АГРОНОМ' : 'ВЫ'}</span><div>{message.content}</div></div>)}
          {busy && <div className="agro-ai__thinking"><Sparkles size={15}/> Анализирую прогноз и данные поля…</div>}
        </div>
        {error && <div role="alert" className="agro-ai__error">{error}</div>}
        {!status?.configured && !statusError && status && <div className="agro-ai__setup">Добавь <code>DEEPSEEK_API_KEY</code> в <code>backend/.env</code> и перезапусти FastAPI.</div>}
        {statusError && <div className="agro-ai__setup">{statusError}</div>}
        <form className="agro-ai__composer" onSubmit={e => { e.preventDefault(); void send(prompt) }}>
          <textarea aria-label="Вопрос ИИ-агроному" placeholder={field ? `Спроси о поле «${field.name}»…` : 'Сначала выбери поле'} value={prompt} maxLength={2000} rows={2} disabled={!field || !status?.configured || busy} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(prompt) } }} />
          <button type="submit" title="Отправить вопрос" disabled={!prompt.trim() || !field || !status?.configured || busy}><Send size={17}/> Отправить</button>
        </form>
        <div className="agro-ai__footer">DeepSeek · {status?.model ?? 'ожидание'} · Контекст запрашивается у FastAPI перед каждым ответом · Внешний ИИ-сервис получает данные выбранного поля и историю отправляемого диалога.</div>
      </div>
    </div>
  </section>
}
