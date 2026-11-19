import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Check, Eye, LayoutDashboard, Plus, RotateCcw, Settings2, X } from 'lucide-react'
import { initialPreferences, type UiPreferences } from './uiPreferences'
import { useWorkspaceStore } from './useWorkspaceStore'
import WorkspaceGrid, { type RenderWidget } from './WorkspaceGrid'
import {
  columns, freshWorkspace, limits, makeTile, newId, repeatable, templateNames, templateTiles, widgets,
  type Device, type Kind, type Profile, type Template, type Tile, type Workspace,
} from './workspaceLayout'

const screen = window.matchMedia('(max-width: 800px)')
function subscribe(fn: () => void) { screen.addEventListener('change', fn); return () => screen.removeEventListener('change', fn) }
const kinds = Object.keys(widgets) as Kind[]
export default function DashboardWorkspace({ preferences, render, fields, picker }: {
  preferences: UiPreferences; render: RenderWidget; fields: {id:number; name:string}[]; picker: ReactNode
}) {
  const mobile = useSyncExternalStore(subscribe, () => screen.matches)
  const device: Device = mobile ? 'mobile' : 'desktop'
  const store = useWorkspaceStore()
  const [draft, setDraft] = useState<Workspace | null>(null)
  const [preview, setPreview] = useState(false)
  const [catalog, setCatalog] = useState(false)
  const [inspecting, setInspecting] = useState('')
  const [message, setMessage] = useState('')
  const toolbar = useRef<HTMLDivElement>(null)
  const workspace = draft ?? store.saved
  const profile = workspace.layouts.find(p => p.id === workspace.active)!
  const editing = !!draft && !preview && !store.saving
  const tiles = useMemo(() => profile[device] ?? templateTiles('classic', device, preferences), [profile,device,preferences])
  const visible = useMemo(() => tiles.filter(t => !t.hidden), [tiles])
  const hidden = tiles.filter(t => t.hidden)
  const inspector = visible.find(t => t.id === inspecting)
  function alterProfile(update: Partial<Profile>) {
    if (!draft) return
    setDraft({...draft, layouts:draft.layouts.map(p => p.id === profile.id ? {...p, ...update} : p)})
    setMessage('')
  }
  function changeTiles(next: Tile[]) { alterProfile({[device]:next}) }
  function inspect(id: string) {
    setInspecting(id)
    setCatalog(false)
    toolbar.current?.scrollIntoView({block:'start'})
  }
  function closeEditor() { setDraft(null); setPreview(false); setCatalog(false); setInspecting('') }
  async function saveDraft() {
    if (!draft) return
    const layouts = draft.layouts.map(p => ({...p, name:p.name.trim()}))
    if (layouts.some(p => !p.name)) { setMessage('Укажи название каждого макета.'); return }
    if (await store.save({...draft, layouts})) {
      closeEditor()
      setMessage('Макет «' + profile.name.trim() + '» сохранён в твоём аккаунте.')
    }
  }
  function addProfile() {
    if (!draft || draft.layouts.length >= limits.profiles) return
    const copy = {...profile, id:newId(), name:'Мой макет ' + (draft.layouts.length + 1)}
    setDraft({...draft, active:copy.id, layouts:[...draft.layouts,copy]})
    setInspecting('')
    setMessage('')
  }
  function addWidget(type: Kind) {
    const tile = makeTile(type, device, newId())
    tile.y = visible.reduce((max,t) => Math.max(max, t.y + (t.h ?? widgets[t.type].minH)), 0) + 1
    changeTiles([...tiles, tile])
    setMessage('Добавлен виджет «' + widgets[type].title + '».')
  }
  const profileSelect = <select aria-label="Сохранённый макет" value={workspace.active} disabled={store.saving || !store.ready}
    onChange={e => {
      const next = {...workspace, active:e.target.value}
      setInspecting('')
      setMessage('')
      if (draft) setDraft(next)
      else void store.save(next)
    }}>{workspace.layouts.map(p => <option key={p.id} value={p.id}>{p.name || 'Без названия'}</option>)}</select>
  return <div className="studio">
    <div className="studio-bar" ref={toolbar}>
      <div className="studio-bar-main">
        <div className="studio-profile"><LayoutDashboard size={18}/>{workspace.layouts.length > 1 ? profileSelect : <strong>{profile.name || 'Мой макет'}</strong>}</div>
        <div className="studio-buttons">{picker}
          {!draft ? <button type="button" className="studio-primary" disabled={!store.ready || store.saving}
            onClick={() => {setDraft(store.saved); setMessage('')}}><Settings2 size={16}/> Настроить интерфейс</button> : <>
            <button type="button" disabled={store.saving} aria-pressed={preview} onClick={() => {setPreview(!preview); setCatalog(false); setInspecting('')}}>
              <Eye size={16}/>{preview ? 'Вернуться к настройке' : 'Предпросмотр'}</button>
            <button type="button" className="studio-primary" disabled={store.saving || !store.ready}
              onClick={() => void saveDraft()}><Check size={16}/>{store.saving ? 'Сохранение…' : 'Сохранить'}</button>
            <button type="button" disabled={store.saving} onClick={() => {closeEditor(); setMessage('Изменения отменены.')}}>Отменить изменения</button>
          </>}
        </div>
      </div>
      {editing && <div className="studio-editor">
        <label>Название макета<input value={profile.name} maxLength={limits.name} onChange={e => alterProfile({name:e.target.value})}/></label>
        <label>Шаблон для {mobile ? 'телефона' : 'компьютера'}<select value="" onChange={e => {
          const template = e.target.value as Template
          changeTiles(templateTiles(template, device, template === 'classic' ? initialPreferences(mobile) : undefined))
          setInspecting('')
        }}><option value="" disabled>Применить шаблон…</option>{Object.entries(templateNames).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <div className="studio-buttons">
          <button type="button" onClick={addProfile} disabled={workspace.layouts.length >= limits.profiles}><Plus size={16}/> Новый макет</button>
          <button type="button" aria-expanded={catalog} onClick={() => {setCatalog(!catalog);setInspecting('')}}><Plus size={16}/> Добавить виджет</button>
          <button type="button" onClick={() => {changeTiles(templateTiles('classic', device, initialPreferences(mobile)));setInspecting('');setMessage('Стандартное расположение восстановлено в черновике.')}}><RotateCcw size={15}/> Сбросить настройки</button>
        </div>
        <p className="studio-hint">{mobile ? 'Макет телефона. Стрелки в заголовке меняют порядок блоков.' : 'Макет компьютера. Перетащи блок за заголовок или потяни за нижний правый угол.'}</p>
      </div>}
      {editing && catalog && <section className="studio-catalog" aria-label="Каталог виджетов">
        {hidden.map(tile => <button key={tile.id} type="button" aria-label={'Вернуть: ' + widgets[tile.type].title}
          onClick={() => changeTiles(tiles.map(t => t.id === tile.id ? {...t,hidden:false} : t))}>
          <RotateCcw size={15}/> Вернуть · {widgets[tile.type].title}{tile.fieldId && ' · ' + (fields.find(f => f.id === tile.fieldId)?.name ?? 'Поле')}
        </button>)}
        {kinds.map(type => {
          const present = tiles.filter(tile => tile.type === type).length
          return <button type="button" key={type} disabled={tiles.length >= limits.widgets || (!!present && !repeatable(type))}
            aria-label={'Добавить: ' + widgets[type].title} onClick={() => addWidget(type)}>
            {present && !repeatable(type) ? <Check size={15}/> : <Plus size={15}/>}
            {widgets[type].title}{present > 0 && <small>{present}</small>}
          </button>
        })}
      </section>}
      {editing && inspector && <div className="studio-inspector">
        <strong>{widgets[inspector.type].title}</strong>
        {device === 'desktop' && <label>Ширина в колонках<select value={inspector.w}
          onChange={e => changeTiles(tiles.map(t => t.id === inspector.id ? {...t,w:+e.target.value,x:Math.min(t.x,columns(device)-Number(e.target.value))} : t))}>
          {Array.from({length:13-widgets[inspector.type].minW}, (_,i) => i + widgets[inspector.type].minW).map(w => <option key={w}>{w}</option>)}</select></label>}
        <label>Высота в строках<input type="number" key={inspector.id+':'+inspector.h}
          min={widgets[inspector.type].minH} max={limits.height} defaultValue={inspector.h ?? ''} placeholder="Авто"
          onBlur={e => {
            const value = e.target.value === '' ? null : Math.max(widgets[inspector.type].minH, Math.min(limits.height, Math.round(Number(e.target.value))))
            if (value !== inspector.h) changeTiles(tiles.map(t => t.id === inspector.id ? {...t,h:value} : t))
          }}/></label>
        {repeatable(inspector.type) && <label>Поле виджета<select value={inspector.fieldId ?? ''} onChange={e => changeTiles(tiles.map(t => t.id === inspector.id ? {...t,fieldId:Number(e.target.value) || null} : t))}>
          <option value="">Выбранное в обзоре</option>{fields.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>}
        <button type="button" onClick={() => setInspecting('')}><X size={15}/> Закрыть параметры</button>
      </div>}
      {preview && <p className="studio-hint">Предпросмотр макета для {mobile ? 'телефона' : 'компьютера'}. Изменения ещё не сохранены.</p>}
    </div>
    {store.error && <div className="studio-notice" role="alert">{store.error}
      {(store.problem === 'load' || store.problem === 'conflict') && <button onClick={() => {closeEditor();store.retry()}}>Загрузить сохранённую версию</button>}
      {store.problem === 'damaged' && <button onClick={() => void store.save(freshWorkspace())}>Восстановить стандартный макет</button>}
    </div>}
    {message && <p className="studio-notice" role="status">{message}</p>}
    {!visible.length && <p className="agr-empty">Рабочее пространство пусто. Открой каталог и добавь первый виджет.</p>}
    <WorkspaceGrid tiles={visible} device={device} editing={editing} render={render} onInspect={inspect}
      onHide={id => changeTiles(tiles.map(t => t.id === id ? {...t,hidden:true} : t))}
      onChange={next => changeTiles([...next, ...hidden])}/>
  </div>
}
