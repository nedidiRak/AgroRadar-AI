import {createContext, useCallback, useContext, useEffect, useRef, useState} from 'react'
import {apiFetch} from '../authClient'
import {adminSteps, observerSteps, version, type TrainingView} from './scenarios'

type Status = 'new' | 'active' | 'paused' | 'declined' | 'completed'
type Progress = {step:string; status:Status}
const initial: Progress = {step:'welcome', status:'new'}
const endpoint = '/api/me/onboarding'

export function useTraining(admin:boolean, navigate:(view:TrainingView)=>void) {
  const steps = admin ? adminSteps : observerSteps
  const [progress, setProgress] = useState(initial)
  const [running, setRunning] = useState(false)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState('')
  const [retry, setRetry] = useState(0)
  const revision = useRef<number|null>(null)
  const generation = useRef(0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const opener = useRef<HTMLElement|null>(null)
  const position = Math.max(0, steps.findIndex(s => s.id === progress.step))
  const step = running ? steps[position] : null

  useEffect(() => {
    const controller = new AbortController()
    const token = ++generation.current
    revision.current = null
    setReady(false)
    async function load() {
      try {
        const res = await apiFetch(endpoint, {signal:controller.signal})
        if (!res.ok) throw Error()
        const data = await res.json()
        if (generation.current !== token) return
        if (data.version !== version || data.role !== (admin?'admin':'viewer') ||
            !steps.some(s => s.id===data.step) || !Number.isSafeInteger(data.revision) ||
            !['new','active','paused','declined','completed'].includes(data.status)) throw Error()
        revision.current = data.revision
        setProgress({step:data.step,status:data.status})
        setNotice('')
      } catch {
        if (!controller.signal.aborted) setNotice('Прогресс на сервере недоступен. Можно пройти маршрут в этом окне.')
      } finally { if (!controller.signal.aborted) setReady(true) }
    }
    void load()
    return () => {++generation.current; controller.abort()}
  }, [admin, steps, retry])

  const record = useCallback((next:Progress) => {
    setProgress(next)
    const token = generation.current
    queue.current = queue.current.then(async () => {
      if (generation.current !== token || revision.current===null) return
      try {
        const res = await apiFetch(endpoint,{method:'PUT',keepalive:true,headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...next,version,revision:revision.current})})
        if (generation.current !== token) return
        if (res.status === 409) {
          revision.current=null
          setNotice('Прогресс изменился в другом окне. Загрузите его из настроек, чтобы продолжить синхронизацию.')
          return
        }
        if (!res.ok) throw Error()
        const data = await res.json()
        if (generation.current===token) revision.current=data.revision
      } catch {
        if (generation.current===token) {
          revision.current=null
          setNotice('Не удалось сохранить прогресс. Маршрут доступен в этом окне. Повторите подключение в настройках.')
        }
      }
    })
  }, [])
  const restoreFocus = () => requestAnimationFrame(() => {
    const el = opener.current
    const fallback = Array.from(document.querySelectorAll<HTMLElement>('[data-learn="settings"]')).find(node=>node.getClientRects().length)
    ;(el?.isConnected && el.getClientRects().length ? el : fallback)?.focus({preventScroll:true})
  })
  function start() {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const next = progress.status==='completed' || progress.status==='declined' ? steps[0] : steps[position]
    record({step:next.id,status:'active'})
    setRunning(true)
    navigate(next.view)
  }
  function go(index:number) {
    const next = steps[index]
    if (!next) return
    record({step:next.id,status:'active'})
    navigate(next.view)
  }
  function pause() { setRunning(false); record({...progress,status:'paused'}); restoreFocus() }
  function finish() { setRunning(false); record({step:'finish',status:'completed'}); restoreFocus() }
  return {steps,position,step,progress,ready,running,notice,start,pause,finish,go,
    action:(id:string)=>{if(step?.id===id) go(position+1)},
    reset:()=>{setRunning(false);record(initial)},
    decline:()=>record({...progress,status:'declined'}),
    reload:()=>{setRunning(false);setRetry(n=>n+1)}}
}
export type Training = ReturnType<typeof useTraining>
export const TrainingContext = createContext<Training|null>(null)
export const useCoach = () => useContext(TrainingContext)
