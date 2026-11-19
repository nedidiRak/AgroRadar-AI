import {useEffect, useLayoutEffect, useRef} from 'react'
import {createPortal} from 'react-dom'
import {ArrowLeft, ArrowRight, Bot, Check, ClipboardList, CloudSun, Compass, Flag, LayoutDashboard, Map, PanelsTopLeft, Play, ShieldAlert, Sprout, X} from 'lucide-react'
import {topics} from './scenarios'
import {useCoach, type Training} from './useTraining'
import {useSpotlight} from './useSpotlight'
import './training.css'

const icons={start:Compass,overview:LayoutDashboard,map:Map,weather:CloudSun,risk:ShieldAlert,ai:Bot,work:ClipboardList,layout:PanelsTopLeft,finish:Flag}
export function TrainingWelcome() {
  const tour=useCoach()!
  if(!tour.ready || tour.running || ['declined','completed'].includes(tour.progress.status)) return null
  const resume=['active','paused'].includes(tour.progress.status)
  return <section className="learn-welcome" aria-labelledby="learn-welcome-title" data-training-welcome>
    <div className="learn-welcome-mark" aria-hidden="true"><Sprout/></div>
    <div className="learn-welcome-copy"><h2 id="learn-welcome-title">{resume?'Продолжим знакомство с AgroRadar AI?':'Добро пожаловать в AgroRadar AI!'}</h2>
      <p>{resume?'Вы остановились на этапе «'+tour.steps[tour.position].title+'».':'Научитесь анализировать состояние полей, отслеживать погодные угрозы и принимать решения с поддержкой искусственного интеллекта.'}</p>
      {tour.notice && <p role="status">{tour.notice}</p>}
      <div className="learn-actions"><button className="learn-primary" onClick={tour.start}><Play size={15}/>{resume?'Продолжить обучение':'Начать обучение'}</button>
        <button className="learn-quiet" onClick={tour.decline}>Изучить самостоятельно</button></div>
    </div>
  </section>
}
export function TrainingSettings({close}:{close:()=>void}) {
  const t=useCoach()!
  return <section className="learn-settings" aria-label="Обучение работе с AgroRadar AI">
    <h3><Compass size={18}/> Обучение</h3>
    <p>{t.progress.status==='completed'?'Маршрут пройден. Его можно повторить.':t.position>0?'Сохранён этап «'+t.steps[t.position].title+'».':'Познакомьтесь с картой, прогнозом и помощником на примере выбранного поля.'}</p>
    <div className="learn-actions"><button disabled={!t.ready} onClick={()=>{close();t.start()}}>Пройти обучение</button>
      {t.progress.status!=='new' && <button onClick={t.reset}>Сбросить прогресс</button>}</div>
    {t.notice && <p role="status">{t.notice} <button onClick={t.reload}>Загрузить прогресс</button></p>}
  </section>
}
const focusable='button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]'
export function TrainingOverlay({tour,theme}:{tour:Training;theme:string}) {
  const step=tour.step!
  const panel=useRef<HTMLElement>(null)
  const scene=useSpotlight(step,panel)
  const latest=useRef(tour)
  latest.current=tour
  useLayoutEffect(()=>{panel.current?.focus({preventScroll:true})},[step])
  useEffect(()=>{
    const allowed=(node:Element)=>!!scene.anchor?.contains(node) && !!step.action
    function click(e:MouseEvent) {
      if(!(e.target instanceof Element)||panel.current?.contains(e.target)) return
      if(!allowed(e.target)) { e.preventDefault();e.stopPropagation() }
    }
    function completed(e:Event) {
      if(e.target instanceof Element && allowed(e.target) && step.action===e.type) latest.current.action(step.id)
    }
    function key(e:KeyboardEvent) {
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();latest.current.pause();return}
      if(e.key!=='Tab') return
      const target=scene.anchor
      const targets=target&&step.action?[...(target.matches(focusable)?[target]:[]),...target.querySelectorAll<HTMLElement>(focusable)]:[]
      const items=[...targets,...(panel.current?.querySelectorAll<HTMLElement>(focusable)??[])].filter(el=>el.getClientRects().length)
      if(!items.length) return
      const i=items.indexOf(document.activeElement as HTMLElement)
      const next=i===-1?(e.shiftKey?items.length-1:0):(i+(e.shiftKey?-1:1)+items.length)%items.length
      e.preventDefault();items[next].focus()
    }
    document.addEventListener('click',click,true);document.addEventListener('click',completed)
    document.addEventListener('change',completed);document.addEventListener('keydown',key,true)
    return ()=>{document.removeEventListener('click',click,true);document.removeEventListener('click',completed)
      document.removeEventListener('change',completed);document.removeEventListener('keydown',key,true)}
  },[step,scene.anchor])
  const {position,steps}=tour
  const Icon=icons[step.topic],box=scene.box
  return createPortal(<div className={'learn-layer '+theme} data-training-layer>
    {box?<div key={step.id} aria-hidden="true" className="learn-spot" style={box}/>:<div aria-hidden="true" className="learn-dim"/>}
    <section ref={panel} className="learn-card" role="dialog" aria-labelledby="learn-step-title" aria-describedby="learn-step-text"
      data-training-step={step.id} data-guided-action={step.action?true:undefined} tabIndex={-1} style={{left:scene.x,top:scene.y}}>
      <header><span className="learn-topic"><Icon size={17}/>{topics[step.topic]}</span>
        <button className="learn-close" aria-label="Продолжить позже" title="Продолжить позже (Esc)" onClick={tour.pause}><X size={18}/></button></header>
      <div className="learn-card-body" key={step.id}><h2 id="learn-step-title">{step.title}</h2>
        <p id="learn-step-text">{step.text}</p>
        {scene.missing ? <p className="learn-instruction" role="status">{step.optional?'Виджет скрыт или пока нет данных. Можно пропустить этот шаг.':'Элемент сейчас недоступен. Можно подождать или пропустить шаг.'}</p> :
          step.action && <p className="learn-instruction">{scene.anchor?step.hint:'Ищем элемент на странице…'}</p>}
      </div>
      <footer><div className="learn-meter"><span>Шаг {position+1} из {steps.length}</span><progress max={steps.length} value={position+1} aria-label="Прогресс обучения"/></div>
        <div className="learn-controls">
          <button className="learn-back" aria-label="Назад" title="Назад" disabled={!position} onClick={()=>tour.go(position-1)}><ArrowLeft size={16}/></button>
          {step.id==='studio' && <button className="learn-quiet" onClick={()=>tour.go(steps.length-1)}>Пропустить практику</button>}
          {step.id==='finish'?<button className="learn-primary" onClick={tour.finish}><Check size={16}/>Завершить обучение</button>:
            step.action || (scene.missing && step.id!=='studio') ? <button className="learn-quiet" onClick={()=>tour.go(position+1)}>Пропустить шаг</button> :
            <button className="learn-primary" onClick={()=>tour.go(position+1)}>{step.id==='studio'?step.hint:'Далее'} <ArrowRight size={15}/></button>}
        </div></footer>
    </section>
  </div>,document.body)
}
