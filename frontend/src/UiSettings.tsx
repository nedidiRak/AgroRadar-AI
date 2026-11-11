import { useEffect, useRef } from 'react'
import { Check, Eye, RotateCcw, Settings2, X } from 'lucide-react'
import {
  presetOf, type UiFlag, type UiPreferences, type UiPreset,
} from './uiPreferences'
import './UiSettings.css'

type Entry = {key:UiFlag; label:string; hint?:string}
const sections: {title:string;hint:string;items:Entry[]}[] = [
  { title:'Основной экран', hint:'Сводка и навигация', items:[
    {key:'viewerNotice',label:'Большой баннер наблюдателя'},
    {key:'weatherBadge',label:'Индикатор источника погоды'},
    {key:'navLabels',label:'Подписи в навигации',hint:'Иконки и названия разделов'},
    {key:'footer',label:'Нижний служебный текст'},
  ]},
  { title:'Обзор хозяйства', hint:'Показывай только нужные блоки', items:[
    {key:'overviewStats',label:'Ключевые показатели'},
    {key:'overviewFieldList',label:'Список полей и рисков'},
    {key:'overviewForecast',label:'Карточка прогноза'},
    {key:'overviewRiskDetails',label:'Расширенный AgroRisk Engine'},
    {key:'overviewHelp',label:'Справка о показателях'},
  ]},
  { title:'ИИ-агроном', hint:'Освободи максимум места для переписки', items:[
    {key:'aiFieldPicker',label:'Выбор поля над чатом'},
    {key:'aiMapShortcut',label:'Кнопка «На карте»'},
    {key:'aiContext',label:'Дополнительные данные поля',hint:'Можно раскрывать отдельно'},
    {key:'aiSuggestions',label:'Быстрые вопросы к ИИ'},
    {key:'aiActions',label:'Отдельные кнопки экспорта и нового диалога',hint:'Если скрыты, остаются в меню «Ещё»'},
    {key:'aiTechnicalInfo',label:'Техническая информация DeepSeek'},
    {key:'aiStatus',label:'Статус подключения ИИ',hint:'Ошибки подключения всё равно показываются'},
  ]},
]
const presets: {id:UiPreset;title:string;subtitle:string}[]=[
  {id:'compact',title:'Компактный',subtitle:'Удобно для телефона и защиты'},
  {id:'balanced',title:'Обычный',subtitle:'Для повседневной работы'},
  {id:'expert',title:'Экспертный',subtitle:'Все блоки и подписи'},
]

type Props = {
  value:UiPreferences
  onChange:(key:UiFlag,visible:boolean)=>void
  onPreset:(preset:UiPreset)=>void
  onClose:()=>void
}
export default function UiSettings({value,onChange,onPreset,onClose}:Props) {
  const dialog = useRef<HTMLElement>(null)
  const close = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const oldOverflow = document.body.style.overflow
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    function onKey(event:KeyboardEvent) {
      if (event.key==='Escape') { event.preventDefault(); onClose(); return }
      if (event.key!=='Tab' || !dialog.current) return
      const nodes=Array.from(dialog.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),[tabindex]:not([tabindex="-1"])',
      ))
      if (!nodes.length) return
      const first=nodes[0],last=nodes[nodes.length-1]
      if (event.shiftKey && document.activeElement===first) {
        event.preventDefault();last.focus()
      } else if (!event.shiftKey && document.activeElement===last) {
        event.preventDefault();first.focus()
      }
    }
    window.addEventListener('keydown',onKey)
    return () => {
      document.body.style.overflow=oldOverflow
      window.removeEventListener('keydown',onKey)
      active?.focus()
    }
  }, [onClose])

  const current=presetOf(value)
  return <div className="agr-settings-backdrop" role="presentation"
    onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
    <section className="agr-settings-panel" ref={dialog} role="dialog" aria-modal="true"
      aria-labelledby="agr-settings-title" aria-describedby="agr-settings-description">
      <header className="agr-settings-header">
        <div className="agr-settings-icon"><Settings2 size={21}/></div>
        <div className="agr-settings-header-text">
          <h2 id="agr-settings-title">Настройки интерфейса</h2>
          <p id="agr-settings-description">Убери лишнее — и верни в любой момент.</p>
        </div>
        <button type="button" ref={close} className="agr-settings-close"
          aria-label="Закрыть настройки" title="Закрыть настройки" onClick={onClose}><X size={20}/></button>
      </header>
      <div className="agr-settings-scroll">
        <div className="agr-settings-subheading">
          <strong>Готовый режим</strong>
          <span>{current==='custom'?'Твои настройки':'Выбран готовый режим'}</span>
        </div>
        <div className="agr-settings-presets" role="group" aria-label="Готовые режимы">
          {presets.map(p=><button type="button" key={p.id}
            className={'agr-settings-preset '+(current===p.id?'is-selected':'')}
            aria-pressed={current===p.id} onClick={()=>onPreset(p.id)}>
            <span className="agr-settings-preset-title">{p.title}{current===p.id&&<Check size={16}/>}</span>
            <small>{p.subtitle}</small>
          </button>)}
        </div>
        <p className="agr-settings-scope">Настройки автоматически сохраняются в этом браузере отдельно для каждого логина. Они меняют только внешний вид, не данные или права доступа.</p>
        {sections.map(section=><section className="agr-settings-section" key={section.title}>
          <div className="agr-settings-section-head"><strong>{section.title}</strong><small>{section.hint}</small></div>
          {section.items.map(item=><label className="agr-settings-toggle" key={item.key}>
            <span><strong>{item.label}</strong>{item.hint&&<small>{item.hint}</small>}</span>
            <input type="checkbox" checked={value[item.key]}
              onChange={event=>onChange(item.key,event.target.checked)}
              aria-label={item.label}/>
            <span className="agr-settings-switch" aria-hidden="true"/>
          </label>)}
        </section>)}
        <div className="agr-settings-safety"><Eye size={17}/>
          <p>Навигация, настройки, поле ввода ИИ и важные сообщения об ошибках всегда остаются доступными. Скрытие элементов не изменяет права наблюдателя.</p>
        </div>
      </div>
      <footer className="agr-settings-footer">
        <button type="button" className="agr-settings-reset" onClick={()=>onPreset('compact')}
          title="Вернуть компактный интерфейс"><RotateCcw size={16}/> Компактный вид</button>
        <button type="button" className="agr-settings-done" onClick={onClose}>Готово</button>
      </footer>
    </section>
  </div>
}
