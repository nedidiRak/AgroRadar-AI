import {useId,useRef,useState} from 'react'
import {CircleHelp} from 'lucide-react'

const notes = {
  risk:['Уровень риска','Цвет объединяет погодные факторы для выбранного поля. Посмотрите причину и ожидаемый период угрозы. «Нет данных» означает, что расчёту не хватает сведений.'],
  source:['Источник погоды','В рабочем режиме используется OpenWeather. Метка «Демо» обозначает учебные значения. Почасовые точки — прогноз модели для координат поля.'],
  observation:['Прогноз и наблюдение','Прогноз описывает ожидаемые условия. Наблюдение — датированная запись человека о том, что он увидел при осмотре участка.'],
  ai:['Рекомендации ИИ','Помощник учитывает выбранное поле и доступные сведения. Проверьте вывод по данным поля и обсудите его с агрономом перед агротехническими действиями.'],
  passport:['Агрономический паспорт','Здесь указывают дату посева, фазу развития и тип почвы. Эти сведения вносит человек. Пустое значение означает, что запись ещё не заполнена.'],
  layout:['Сохранение макета','Измените блоки в конструкторе и нажмите «Сохранить». Макет привязан к аккаунту. Для компьютера и телефона хранятся отдельные варианты.'],
} as const
export function ContextHelp({topic}:{topic:keyof typeof notes}) {
  const [open,setOpen]=useState(false)
  const pinned=useRef(false)
  const close=()=>{pinned.current=false;setOpen(false)}
  const id=useId()
  const [label,body]=notes[topic]
  return <div className="learn-help" data-context-help={topic}
    onPointerEnter={e=>{if(e.pointerType==='mouse')setOpen(true)}} onPointerLeave={e=>{if(!pinned.current && !e.currentTarget.contains(document.activeElement))setOpen(false)}}>
    <button type="button" aria-expanded={open} aria-controls={id} aria-label={'Справка — '+label}
      onClick={()=>{pinned.current=!pinned.current;setOpen(pinned.current)}} onFocus={()=>setOpen(true)} onBlur={close}
      onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();close()}}}><CircleHelp size={15}/>{label}</button>
    <span id={id} hidden={!open}>{body}</span>
  </div>
}
