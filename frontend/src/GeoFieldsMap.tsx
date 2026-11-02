import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection, Polygon as GeoPolygon } from 'geojson'
import { Check, Crosshair, Expand, Focus, Layers, Map as MapIcon, Minus, Pencil, Plus, Satellite, Shrink, Undo2, X } from 'lucide-react'
import './GeoFieldsMap.css'

// API 2.1 provides high-resolution satellite / hybrid / street map layers.
// It is loaded via the official Yandex script, without an extra React adapter.
// No Leaflet or third-party tile source is used by this component.
type Risk = 'high' | 'medium' | 'low' | 'unknown'
type Field = {
  id: number; name: string; crop: string; area_ha: number;
  lat: number; lon: number; geometry_source?: string;
  risk: { level: Risk; label: string }
}
type Props = {
  fields: Field[];
  activeId?: number;
  onSelect: (id: number) => void;
  geojson: FeatureCollection<GeoPolygon> | null;
  onSaveGeometry: (fieldId: number, points: [number, number][]) => Promise<boolean>;
  onCreateOutline: (points: [number, number][]) => void;
  canEdit?: boolean;
}
type LayerName = 'satellite' | 'hybrid' | 'map'
type LatLon = [number, number]
const colors: Record<Risk, string> = { high: '#f87171', medium: '#f6c65b', low: '#62dbad', unknown: '#94a3b8' }
// Yandex's hintContent is HTML; never interpolate unescaped user-provided names.
const escapeHint = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char] ?? char))
const layers: Record<LayerName, string> = {
  satellite: 'yandex#satellite', hybrid: 'yandex#hybrid', map: 'yandex#map',
}
const key = (import.meta.env.VITE_YANDEX_MAPS_API_KEY as string | undefined)?.trim() ?? ''

// Yandex Maps 2.1 does not ship TypeScript types with this project.
// The dynamic API is deliberately isolated in this one file.
declare global { interface Window { ymaps?: any } }
let apiPromise: Promise<any> | null = null
function loadYandexMaps(): Promise<any> {
  if (window.ymaps?.Map) return new Promise((resolve, reject) => {
    window.ymaps.ready(() => resolve(window.ymaps), (e: unknown) => reject(e))
  })
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    if (!key) { reject(new Error('Нет ключа VITE_YANDEX_MAPS_API_KEY в frontend/.env.local')); return }
    const script = document.createElement('script')
    script.src = `https://api-maps.yandex.ru/2.1/?apikey=${encodeURIComponent(key)}&lang=ru_RU`
    script.async = true
    script.dataset.agroradarYandex = '1'
    let settled = false
    const timeout = window.setTimeout(() => fail('Превышено время ожидания Яндекс Карт'), 20000)
    function fail(message: string) {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      script.remove()
      reject(new Error(message))
    }
    script.onerror = () => fail('Не удалось загрузить JavaScript API 2.1. Проверь сеть и вкладку Network (api-maps.yandex.ru/2.1).')
    script.onload = () => {
      if (settled) return
      if (!window.ymaps?.ready) { fail('Ответ получен, но объект ymaps не создан. Проверь ответ API в Network.'); return }
      window.ymaps.ready(() => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        resolve(window.ymaps)
      }, (e: unknown) => fail(`Яндекс Карты не инициализировались: ${String(e)}`))
    }
    document.head.appendChild(script)
  }).catch((error) => { apiPromise = null; throw error })
  return apiPromise
}

function boundsOf(fields: Field[]): LatLon[] | null {
  const valid = fields.filter(f => Number.isFinite(f.lat) && Number.isFinite(f.lon))
  if (!valid.length) return null
  const latitudes = valid.map(f => f.lat)
  const longitudes = valid.map(f => f.lon)
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes)
  const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes)
  const latPad = Math.max((maxLat - minLat) * 0.15, 0.003)
  const lonPad = Math.max((maxLon - minLon) * 0.15, 0.005)
  return [[minLat - latPad, minLon - lonPad], [maxLat + latPad, maxLon + lonPad]]
}

export default function GeoFieldsMap({ fields, activeId, onSelect, geojson, onSaveGeometry, onCreateOutline, canEdit = true }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const drawnObjectsRef = useRef<any>(null)
  const fieldsObjectsRef = useRef<any>(null)
  const onSelectRef = useRef(onSelect)
  const drawingRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [layerError, setLayerError] = useState('')
  const [layer, setLayer] = useState<LayerName>('satellite')
  const [showContours, setShowContours] = useState(true)
  const [drawingMode, setDrawingMode] = useState<'new' | 'edit' | null>(null)
  const drawing = drawingMode !== null
  const [points, setPoints] = useState<LatLon[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [overviewTick, setOverviewTick] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const activeField = fields.find(f => f.id === activeId)
  const fieldById = useMemo(() => new Map(fields.map(f => [f.id, f])), [fields])
  const centersKey = fields.map(f => `${f.id}:${f.lat}:${f.lon}`).join('|')
  onSelectRef.current = onSelect
  drawingRef.current = drawing

  // Initialize the real map exactly once per component mount.
  useEffect(() => {
    if (!host.current) return
    let cancelled = false
    loadYandexMaps().then(ymaps => {
      if (cancelled || !host.current) return
      try {
        const map = new ymaps.Map(host.current, {
          center: [50.60, 36.58], zoom: 11, type: layers.satellite,
          controls: [],
        }, { suppressMapOpenBlock: false })
        mapRef.current = map
        fieldsObjectsRef.current = new ymaps.GeoObjectCollection()
        drawnObjectsRef.current = new ymaps.GeoObjectCollection()
        map.geoObjects.add(fieldsObjectsRef.current)
        map.geoObjects.add(drawnObjectsRef.current)
        map.events.add('click', (event: any) => {
          if (!drawingRef.current) return
          const coord: number[] | undefined = event.get('coords')
          if (coord?.length === 2) setPoints(prev => prev.length < 500 ? [...prev, [coord[0], coord[1]]] : prev)
        })
        setLoadError('')
        setLoaded(true)
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Не удалось создать карту Яндекса')
      }
    }).catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Ошибка загрузки API') })
    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.destroy(); mapRef.current = null }
      fieldsObjectsRef.current = null
      drawnObjectsRef.current = null
    }
  }, [])

  // Map viewport changes when the toolbar wraps or fullscreen mode is toggled.
  useEffect(() => {
    if (!loaded || !mapRef.current || !host.current) return
    const map = mapRef.current
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        try { map.container.fitToViewport() } catch (e) { console.warn('Карта: пересчёт размера', e) }
      })
    })
    observer.observe(host.current)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [loaded])

  useEffect(() => {
    if (!expanded) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onEscape)
    }
  }, [expanded])

  // When the user switches from «Карта и поля» to another workspace tab,
  // React keeps the Yandex map mounted inside a hidden section to preserve
  // its state. The fullscreen map must release the body scroll lock at once.
  useEffect(() => {
    const page = host.current?.closest<HTMLElement>('.agr-page--fields')
    if (!page) return

    const closeFullscreenIfHidden = () => {
      if (page.hidden) setExpanded(false)
    }

    const observer = new MutationObserver(closeFullscreenIfHidden)
    observer.observe(page, { attributes: true, attributeFilter: ['hidden'] })
    closeFullscreenIfHidden()
    return () => observer.disconnect()
  }, [])

  // The initial map type was already set in the constructor. Calling setType
  // again on mount can produce a rejected API promise even when satellite tiles
  // are displayed correctly. Switch only when the requested type really differs.
  useEffect(() => {
    const map = mapRef.current
    if (!loaded || !map) return
    const requestedType = layers[layer]
    if (map.getType() === requestedType) {
      setLayerError('')
      return
    }
    let disposed = false
    try {
      const transition = map.setType(requestedType)
      // Yandex API 2.1 returns a vow.Promise, not a native Promise.
      transition.then(
        () => { if (!disposed) setLayerError('') },
        (reason: unknown) => {
          if (disposed) return
          console.error('Yandex Maps: setType failed:', reason)
          setLayerError('Не удалось переключить режим карты. Проверь вкладку Console (F12).')
        },
      )
    } catch (reason) {
      console.error('Yandex Maps: setType threw:', reason)
      setLayerError('Ошибка переключения карты. Проверь вкладку Console (F12).')
    }
    return () => { disposed = true }
  }, [loaded, layer])

  useEffect(() => {
    if (!loaded || !mapRef.current) return
    const map = mapRef.current
    const api = window.ymaps
    if (!api || !fieldsObjectsRef.current) return
    const collection = fieldsObjectsRef.current
    collection.removeAll()
    if (showContours && geojson) {
      for (const feature of geojson.features) {
        if (feature.geometry?.type !== 'Polygon') continue
        const id = Number(feature.properties?.field_id)
        const field = fieldById.get(id)
        if (!field) continue
        const coords = feature.geometry.coordinates[0]
          .filter(c => c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
          .map(([lon, lat]) => [lat, lon] as LatLon)
        if (coords.length < 3) continue
        const polygon = new api.Polygon([coords], {
          hintContent: `${escapeHint(field.name)} · ${escapeHint(field.crop)} · ${escapeHint(field.area_ha)} га`,
        }, {
          strokeColor: colors[field.risk.level],
          fillColor: colors[field.risk.level],
          strokeWidth: field.id === activeId ? 4 : 2.5,
          fillOpacity: field.id === activeId ? 0.34 : 0.18,
          strokeStyle: feature.properties?.geometry_source === 'demo_generated' ? 'dash' : 'solid',
        })
        polygon.events.add('click', () => { if (!drawingRef.current) onSelectRef.current(id) })
        collection.add(polygon)
      }
    }
    fields.forEach(field => {
      const placemark = new api.Placemark([field.lat, field.lon], {
        hintContent: `${escapeHint(field.name)} · ${escapeHint(field.crop)} · ${escapeHint(field.area_ha)} га`,
      }, {
        preset: 'islands#circleIcon',
        iconColor: colors[field.risk.level],
        zIndex: field.id === activeId ? 100 : 10,
      })
      placemark.events.add('click', () => { if (!drawingRef.current) onSelectRef.current(field.id) })
      collection.add(placemark)
    })
    // Disable geometry interactions while drawing; clicks reach the map itself.
    collection.options.set('interactivityModel', drawing ? 'default#silent' : 'default#geoObject')
    // Keep the map in control of its own copyrights and attribution.
    void map
  }, [loaded, fields, geojson, showContours, activeId, fieldById, drawing])

  useEffect(() => {
    if (!loaded || !mapRef.current || !drawnObjectsRef.current || !window.ymaps) return
    const collection = drawnObjectsRef.current
    const api = window.ymaps
    collection.removeAll()
    if (drawing && points.length > 0) {
      const line = new api.Polyline(points, {}, { strokeColor: '#48e6aa', strokeWidth: 4, strokeStyle: 'dash' })
      collection.add(line)
      if (points.length >= 3) {
        collection.add(new api.Polygon([points], {}, {
          strokeColor: '#48e6aa', strokeWidth: 2, fillColor: '#48e6aa', fillOpacity: 0.22,
        }))
      }
      // Small vertex marks help with precise boundary drawing.
      points.forEach(p => collection.add(new api.Circle([p, 7], {}, {
        fillColor: '#48e6aa', fillOpacity: 1, strokeColor: '#ffffff', strokeWidth: 1.5,
      })))
    }
    collection.options.set('interactivityModel', 'default#silent')
  }, [loaded, drawing, points])

  useEffect(() => {
    if (!loaded || !mapRef.current || !centersKey || drawing) return
    const bounds = boundsOf(fields)
    if (bounds) mapRef.current.setBounds(bounds, { checkZoomRange: true, zoomMargin: 70 })
  // Fit when field coordinates change, not when refreshed weather changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, centersKey])

  useEffect(() => {
    if (!loaded || !mapRef.current || !activeId || drawing) return
    const field = fields.find(f => f.id === activeId)
    if (field) mapRef.current.setCenter([field.lat, field.lon], 15, { duration: 230 })
  // Move on selection, not when risk/weather changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, activeId])

  useEffect(() => {
    if (!loaded || !mapRef.current || !overviewTick) return
    const bounds = boundsOf(fields)
    if (bounds) mapRef.current.setBounds(bounds, { checkZoomRange: true, zoomMargin: 70 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewTick, loaded])

  function zoomBy(delta: number) {
    const map = mapRef.current
    if (!loaded || !map) return
    const zoom = map.getZoom()
    map.setZoom(Math.max(2, Math.min(21, zoom + delta)), { checkZoomRange: true, duration: 180 })
  }

  function beginDrawing(mode: 'new' | 'edit') {
    if (mode === 'edit' && !activeId) return
    setPoints([])
    setDrawingMode(mode)
    drawingRef.current = true
    setError('')
  }
  function cancelDrawing() {
    setDrawingMode(null)
    drawingRef.current = false
    setPoints([])
    setError('')
  }
  async function saveDrawing() {
    if (points.length < 3 || saving) return
    if (drawingMode === 'new') {
      // Creating a field is NOT the same as replacing the currently selected polygon.
      // Open the metadata form; POST /api/fields will generate a new unique field ID.
      onCreateOutline([...points])
      cancelDrawing()
      return
    }
    if (!activeId) return
    setSaving(true); setError('')
    try {
      const ok = await onSaveGeometry(activeId, points)
      if (ok) cancelDrawing()
      else setError('Не удалось сохранить границу поля. Проверь сообщение сервера.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения контура')
    } finally {
      setSaving(false)
    }
  }

  const modes: { id: LayerName; title: string; Icon: typeof Satellite }[] = [
    { id: 'satellite', title: 'Спутник', Icon: Satellite },
    { id: 'hybrid', title: 'Гибрид', Icon: Layers },
    { id: 'map', title: 'Схема', Icon: MapIcon },
  ]

  return <div className={`geo-map agr-map-shell ${drawing ? 'geo-map--drawing' : ''} ${expanded ? 'agr-map-shell--expanded' : ''}`} aria-label="Карта полей Яндекс">
    <div className="agr-map-toolbar" role="toolbar" aria-label="Управление геокартой">
      <div className="agr-map-toolbar__mode" aria-label="Картографическая подложка">
        <span className="agr-map-toolbar__label">ПОДЛОЖКА</span>
        <div className="agr-map-segments" role="group" aria-label="Режим карты">
          {modes.map(({ id, title, Icon }) => <button
            key={id}
            type="button"
            aria-pressed={layer === id}
            className={`agr-map-segments__button ${layer === id ? 'is-active' : ''}`}
            onClick={() => setLayer(id)}
            disabled={!loaded || drawing}
            title={title}
          ><Icon size={15} strokeWidth={1.8} /><span>{title}</span></button>)}
        </div>
      </div>
      <div className="agr-map-toolbar__actions">
        <div className="agr-map-toolbar__set" role="group" aria-label="Работа с полями">
          <button type="button" className="agr-map-action" onClick={() => setOverviewTick(x => x + 1)} disabled={!loaded || drawing} title="Показать все поля">
            <Focus size={16} strokeWidth={1.9} /><span>Все поля</span>
          </button>
          <button type="button" className={`agr-map-action ${showContours ? 'is-toggled' : ''}`} onClick={() => setShowContours(x => !x)} disabled={!loaded || drawing} aria-pressed={showContours} title={showContours ? 'Скрыть контуры' : 'Показать контуры'}>
            <Layers size={16} strokeWidth={1.9} /><span>Контуры</span>
          </button>
          {canEdit && !drawing && <button type="button" className="agr-map-action agr-map-action--primary" onClick={() => beginDrawing('new')} disabled={!loaded} title="Нарисовать новый участок и создать отдельное поле">
            <Plus size={16} strokeWidth={1.9} /><span>Новое поле</span>
          </button>}
          {canEdit && !drawing && <button type="button" className="agr-map-action" onClick={() => beginDrawing('edit')} disabled={!loaded || !activeId} title="Изменить границы выбранного существующего поля">
            <Pencil size={16} strokeWidth={1.9} /><span>Изменить контур</span>
          </button>}
        </div>
        <span className="agr-map-toolbar__divider" aria-hidden="true" />
        <div className="agr-map-toolbar__set agr-map-toolbar__set--compact" role="group" aria-label="Масштаб и экран">
          <button type="button" className="agr-map-action agr-map-action--square" onClick={() => zoomBy(-1)} disabled={!loaded} aria-label="Уменьшить масштаб" title="Уменьшить"><Minus size={17} /></button>
          <button type="button" className="agr-map-action agr-map-action--square" onClick={() => zoomBy(1)} disabled={!loaded} aria-label="Увеличить масштаб" title="Увеличить"><Plus size={17} /></button>
          <button type="button" className={`agr-map-action agr-map-action--square ${expanded ? 'is-toggled' : ''}`} onClick={() => setExpanded(v => !v)} disabled={!loaded} aria-label={expanded ? 'Свернуть карту' : 'Развернуть карту'} title={expanded ? 'Свернуть карту (Esc)' : 'Во весь экран'}>
            {expanded ? <Shrink size={16} /> : <Expand size={16} />}
          </button>
        </div>
      </div>
    </div>

    {canEdit && drawing && <div className="agr-map-drawbar">
      <div className="agr-map-drawbar__summary">
        <Crosshair size={18} strokeWidth={1.9}/>
        <div><strong>{drawingMode === 'new' ? 'Создание нового поля' : `Редактирование: ${activeField?.name}`}</strong><span>Отмечай углы участка на снимке · {points.length} точек</span></div>
      </div>
      <div className="agr-map-drawbar__buttons">
        <button type="button" onClick={() => setPoints(p => p.slice(0, -1))} disabled={!points.length || saving} title="Удалить последнюю точку"><Undo2 size={16} /><span>Назад</span></button>
        <button type="button" onClick={cancelDrawing} disabled={saving}><X size={16} /><span>Отмена</span></button>
        <button type="button" className="agr-map-drawbar__save" onClick={() => void saveDrawing()} disabled={points.length < 3 || saving}><Check size={16} /><span>{saving ? 'Сохранение…' : drawingMode === 'new' ? 'Далее: название и культура' : 'Сохранить контур'}</span></button>
      </div>
    </div>}

    <div className="agr-map-viewport">
      <div ref={host} className="geo-leaflet-map agr-map-canvas" aria-label="Интерактивная Яндекс Карта с полями" />
      {!loaded && !loadError && <div className="yandex-map-loading">Загрузка Яндекс Карт…</div>}
      {loadError && <div className="agr-map-alert" role="alert">{loadError}<br/>Проверь доступ к JavaScript API 2.1 и HTTP Referer <b>localhost</b>.</div>}
      {!loadError && layerError && <div className="agr-map-alert" role="alert">{layerError}</div>}
      {error && <div className="agr-map-alert agr-map-alert--draw" role="alert">{error}</div>}
    </div>

    <div className="agr-map-status" aria-live="polite">
      <div className="agr-map-status__primary"><span className="agr-map-status__pulse" /> <span>Яндекс Карты</span><span className="agr-map-status__separator">/</span><span>{loaded ? 'Карта подключена' : 'Подключение…'}</span></div>
      <div className="agr-map-status__details">
        {!loaded ? 'Ожидаем загрузку подложки' : drawing ? `${drawingMode === 'new' ? 'Новое поле' : 'Редактирование контура'} · ${points.length} точек` : activeField ? <><span className={`agr-map-risk agr-map-risk--${activeField.risk.level}`} /> <b>{activeField.name}</b><span className="agr-map-status__separator">·</span><span>{activeField.geometry_source === 'user_drawn' ? 'Граница сохранена' : 'Контур демонстрационный'}</span></> : 'Выбери поле для просмотра'}
      </div>
    </div>
  </div>
}
