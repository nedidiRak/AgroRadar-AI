import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection, Polygon as GeoPolygon } from 'geojson'

// API 2.1 provides high-resolution satellite / hybrid / street map layers.
// It is loaded via the official Yandex script, without an extra React adapter.
// No Leaflet or third-party tile source is used by this component.
type Risk = 'high' | 'medium' | 'low'
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
}
type LayerName = 'satellite' | 'hybrid' | 'map'
type LatLon = [number, number]
const colors: Record<Risk, string> = { high: '#f87171', medium: '#f6c65b', low: '#62dbad' }
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

export default function GeoFieldsMap({ fields, activeId, onSelect, geojson, onSaveGeometry }: Props) {
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
  const [drawing, setDrawing] = useState(false)
  const [points, setPoints] = useState<LatLon[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [overviewTick, setOverviewTick] = useState(0)
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
          controls: ['zoomControl'],
        }, { suppressMapOpenBlock: true })
        mapRef.current = map
        fieldsObjectsRef.current = new ymaps.GeoObjectCollection()
        drawnObjectsRef.current = new ymaps.GeoObjectCollection()
        map.geoObjects.add(fieldsObjectsRef.current)
        map.geoObjects.add(drawnObjectsRef.current)
        map.controls.get('zoomControl')?.options.set({ position: { left: 12, bottom: 95 } })
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
          hintContent: `${field.name} · ${field.crop} · ${field.area_ha} га`,
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
        hintContent: `${field.name} · ${field.crop} · ${field.area_ha} га`,
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

  function beginDrawing() {
    if (!activeId) return
    setPoints([])
    setDrawing(true)
    drawingRef.current = true
    setError('')
  }
  function cancelDrawing() {
    setDrawing(false)
    drawingRef.current = false
    setPoints([])
    setError('')
  }
  async function saveDrawing() {
    if (!activeId || points.length < 3 || saving) return
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

  return <div className={`geo-map ${drawing ? 'geo-map--drawing' : ''}`} aria-label="Карта полей Яндекс">
    <div ref={host} className="geo-leaflet-map" aria-label="Яндекс Карта с полями" />
    {!loaded && !loadError && <div className="yandex-map-loading">Загрузка Яндекс Карт…</div>}
    {loadError && <div className="map-network-warning">{loadError}<br/>Проверь доступ к JavaScript API 2.1 и разрешённый HTTP Referer <b>localhost</b>.</div>}
    {!loadError && layerError && <div className="map-network-warning">{layerError}</div>}
    <div className="map-topbar">
      <div className="map-source-tag"><span className="map-source-dot" /> ЯНДЕКС КАРТЫ · GIS</div>
      <div className="map-layer-switch" role="group" aria-label="Режим отображения карты">
        <button type="button" onClick={() => setLayer('satellite')} className={layer === 'satellite' ? 'chosen' : ''}>Спутник</button>
        <button type="button" onClick={() => setLayer('hybrid')} className={layer === 'hybrid' ? 'chosen' : ''}>Гибрид</button>
        <button type="button" onClick={() => setLayer('map')} className={layer === 'map' ? 'chosen' : ''}>Схема</button>
      </div>
    </div>
    <div className="map-side-controls">
      <button type="button" onClick={() => setOverviewTick(x => x + 1)} disabled={!loaded}>⊞ <span>Все поля</span></button>
      <button type="button" onClick={() => setShowContours(x => !x)} className={showContours ? 'selected' : ''} disabled={!loaded}>{showContours ? '◈' : '◇'} <span>Контуры</span></button>
      {!drawing && <button type="button" onClick={beginDrawing} disabled={!loaded || !activeId}>✎ <span>Обвести поле</span></button>}
    </div>
    {drawing && <div className="map-draw-bar">
      <div><strong>Рисуем: {activeField?.name}</strong><span>Отмечай углы поля нажатием на карту (минимум 3 точки).</span></div>
      <div className="map-draw-actions">
        <button type="button" onClick={() => setPoints(p => p.slice(0, -1))} disabled={!points.length || saving}>↶ Отменить точку</button>
        <button type="button" onClick={cancelDrawing} disabled={saving}>Отмена</button>
        <button type="button" className="map-save" onClick={() => void saveDrawing()} disabled={points.length < 3 || saving}>{saving ? 'Сохраняем…' : `✓ Сохранить (${points.length})`}</button>
      </div>
    </div>}
    {error && <div className="map-draw-error">{error}</div>}
    {!drawing && loaded && <div className="map-hint">{activeField?.geometry_source === 'user_drawn'
      ? 'Контур выбранного поля сохранён в FastAPI.'
      : 'Пунктир — демонстрационный контур. Для реальной геометрии обведи поле.'}</div>}
  </div>
}
