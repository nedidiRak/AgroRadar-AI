import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCheck, ClipboardList, Plus, RefreshCcw } from 'lucide-react'
import { apiFetch } from './authClient'
import './FieldTasks.css'

type Task = {
  id:number;field_id:number;field_name:string;title:string;action:string
  status:'planned'|'in_progress'|'done';assigned_to:string;due_date:string|null
  created_at:string;completed_at:string|null;completion_note:string
}
type Field = {id:number;name:string}
export type SuggestedInspection = {field_id:number;alert_id:number;title:string;action:string;sequence:number}
type Props = {fields:Field[];canEdit:boolean;suggested:SuggestedInspection|null}
const labels:Record<Task['status'],string>={planned:'Запланировано',in_progress:'В работе',done:'Выполнено'}
export default function FieldTasks({fields,canEdit,suggested}:Props) {
  const [tasks,setTasks]=useState<Task[]>([])
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [open,setOpen]=useState(false)
  const [form,setForm]=useState({
    field_id:fields[0]?.id??0,title:'',action:'',assigned_to:'',due_date:'',
    alert_id:null as number|null,
  })
  const [completion,setCompletion]=useState<Record<number,string>>({})
  const [onlyOpen,setOnlyOpen]=useState(true)
  const load=useCallback(async()=>{
    setLoading(true)
    try {
      const response=await apiFetch('/api/operations/tasks?limit=200')
      if(!response.ok) throw new Error('Ошибка загрузки заданий: HTTP '+response.status)
      const json=await response.json() as {tasks:Task[]}
      setTasks(json.tasks)
      setError('')
    }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить задания')}
    finally{setLoading(false)}
  },[])
  useEffect(()=>{void load()},[load])
  useEffect(()=>{
    if(!suggested)return
    setForm({field_id:suggested.field_id,title:suggested.title,action:suggested.action,
      assigned_to:'',due_date:'',alert_id:suggested.alert_id})
    setOpen(true)
  },[suggested])
  const visible=useMemo(()=>tasks.filter(t=>!onlyOpen||t.status!=='done'),[tasks,onlyOpen])
  const unresolved=tasks.filter(t=>t.status!=='done').length

  async function postTask(){
    if(!form.field_id||form.title.trim().length<4||form.action.trim().length<5){
      setError('Укажи поле, название и действие.');return
    }
    setBusy(true);setError('');setNotice('')
    try{
      const response=await apiFetch('/api/operations/tasks',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...form,due_date:form.due_date||null}),
      })
      if(!response.ok){
        const body=await response.json().catch(()=>null)
        throw new Error(typeof body?.detail==='string'?body.detail:'Не удалось создать задание')
      }
      setForm({field_id:fields[0]?.id??0,title:'',action:'',assigned_to:'',due_date:'',alert_id:null})
      setOpen(false);setNotice('Задание для обследования сохранено.');await load()
    }catch(e){setError(e instanceof Error?e.message:'Не удалось создать задание')}
    finally{setBusy(false)}
  }

  async function updateTask(task:Task,next:Task['status']){
    const note=(completion[task.id]??'').trim()
    if(next==='done'&&!note){setError('Для завершения задания обязательно запиши результат осмотра.');return}
    setBusy(true);setError('');setNotice('')
    try{
      const response=await apiFetch('/api/operations/tasks/'+task.id,{
        method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({status:next,completion_note:next==='done'?note:''}),
      })
      if(!response.ok){
        const body=await response.json().catch(()=>null)
        throw new Error(typeof body?.detail==='string'?body.detail:'Не удалось изменить статус')
      }
      setNotice('Результат сохранён в журнале действий.');await load()
    }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить статус')}
    finally{setBusy(false)}
  }
  return <section className="agr-tasks" aria-label="Полевые задания">
    <div className="agr-tasks-head">
      <div><h2><ClipboardList size={19}/> Полевые задания</h2>
        <p>От предупреждения — к проверке на участке и зафиксированному результату.</p></div>
      <div className="agr-tasks-actions">
        <button type="button" title="Обновить задания" onClick={()=>void load()} disabled={loading}><RefreshCcw size={16}/></button>
        {canEdit&&<button type="button" onClick={()=>{setOpen(v=>!v);setError('')}}><Plus size={16}/>{open?'Скрыть форму':'Новое задание'}</button>}
      </div>
    </div>
    <div className="agr-tasks-summary">
      <span><b>{unresolved}</b> в работе и плане</span>
      <span><b>{tasks.length-unresolved}</b> выполнено</span>
      <label><input type="checkbox" checked={onlyOpen} onChange={e=>setOnlyOpen(e.target.checked)}/> Только незавершённые</label>
    </div>
    {error&&<p role="alert" className="agr-tasks-error">{error}</p>}
    {notice&&<p role="status" className="agr-tasks-ok">{notice}</p>}
    {canEdit&&open&&<form className="agr-tasks-form" onSubmit={e=>{e.preventDefault();void postTask()}}>
      <label>Поле<select required value={form.field_id} onChange={e=>setForm(f=>({...f,field_id:Number(e.target.value)}))}>
        {fields.map(field=><option key={field.id} value={field.id}>{field.name}</option>)}</select></label>
      <label>Название<input required minLength={4} maxLength={160} value={form.title}
        onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="Например, осмотреть листья пшеницы"/></label>
      <label className="agr-tasks-span">Что проверить<textarea required minLength={5} maxLength={1200} value={form.action}
        onChange={e=>setForm(f=>({...f,action:e.target.value}))} rows={2}
        placeholder="Действие, основание и способ проверки"/></label>
      <label>Ответственный (необязательно)<input maxLength={80} value={form.assigned_to}
        onChange={e=>setForm(f=>({...f,assigned_to:e.target.value}))} placeholder="Агроном"/></label>
      <label>Срок проверки<input type="date" value={form.due_date}
        onChange={e=>setForm(f=>({...f,due_date:e.target.value}))}/></label>
      <button type="submit" disabled={busy||!fields.length}><Plus size={16}/>{busy?'Сохраняем…':'Сохранить задание'}</button>
    </form>}
    {loading&&!tasks.length&&<p className="agr-tasks-empty">Загружаем задания…</p>}
    {!loading&&!visible.length&&<p className="agr-tasks-empty">
      {onlyOpen&&tasks.length?'Нет незавершённых заданий.':'Заданий пока нет. Их можно создать после погодного предупреждения или вручную.'}
    </p>}
    <div className="agr-tasks-list">{visible.map(task=><article key={task.id} className="agr-task">
      <div className="agr-task-head"><strong>{task.title}</strong><span data-state={task.status}>{labels[task.status]}</span></div>
      <small>{task.field_name}{task.assigned_to?' · '+task.assigned_to:''}{task.due_date?' · до '+task.due_date:''}</small>
      <p>{task.action}</p>
      {task.status==='done'&&<div className="agr-task-completed"><CheckCircle2 size={15}/>
        <span><b>Результат:</b> {task.completion_note}</span></div>}
      {canEdit&&task.status!=='done'&&<div className="agr-task-controls">
        {task.status==='planned'&&<button disabled={busy} onClick={()=>void updateTask(task,'in_progress')}>Принять в работу</button>}
        {task.status==='in_progress'&&<>
          <textarea rows={2} maxLength={1000} aria-label={'Результат задания '+task.title}
            placeholder="Зафиксируй фактический результат обследования"
            value={completion[task.id]??''}
            onChange={e=>setCompletion(previous=>({...previous,[task.id]:e.target.value}))}/>
          <button disabled={busy||!(completion[task.id]??'').trim()}
            onClick={()=>void updateTask(task,'done')}><CheckCircle2 size={14}/> Завершить</button>
        </>}
      </div>}
    </article>)}</div>
    <p className="agr-tasks-disclaimer">Выполнение задания не закрывает погодное предупреждение автоматически: оно закрывается только по новой подтверждённой оценке прогноза.</p>
  </section>
}
