import { useEffect, useRef, useState } from 'react'

type Field = {
  id: number
  name: string
  crop: string
  area_ha: number
  lat: number
  lon: number
  risk: { level: 'high' | 'medium' | 'low'; label: string }
}

type Props = {
  fields: Field[]
  activeId?: number
  onSelect: (id: number) => void
}

const colors = { high: '#ef6666', medium: '#e8b74f', low: '#56c6a0' }

// JavaScript API 3.0 загружается один раз, даже в React StrictMode.
let scriptPromise: Promise<void> | undefined
function loadYandexMaps(key: string): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(key)}&lang=ru_RU`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Не удалось загрузить API Яндекс Карт. Проверь интернет и ограничения API-ключа.'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

declare global {
  interface Window { ymaps3?: any }
}

export default function YandexFieldsMap({ fields, activeId, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const onSelectRef = useRef(onSelect)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  onSelectRef.current = onSelect

  useEffect(() => {
    const key = import.meta.env.VITE_YANDEX_MAPS_API_KEY as string | undefined
    if (!key) {
      setError('Добавь VITE_YANDEX_MAPS_API_KEY в frontend/.env.local и перезапусти Vite.')
      return
    }
    let disposed = false
    let createdMap: any
    void (async () => {
      try {
        await loadYandexMaps(key)
        if (!window.ymaps3) throw new Error('API Яндекс Карт не инициализирован.')
        await window.ymaps3.ready
        if (disposed || !container.current) return
        const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer } = window.ymaps3
        createdMap = new YMap(container.current, {
          location: { center: [36.58, 50.601], zoom: 10 },
          behaviors: ['drag', 'scrollZoom', 'pinchZoom', 'dblClick']
        })
        createdMap.addChild(new YMapDefaultSchemeLayer({}))
        createdMap.addChild(new YMapDefaultFeaturesLayer({}))
        mapRef.current = createdMap
        setError('')
        setReady(true)
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : 'Не удалось открыть Яндекс Карты')
      }
    })()
    return () => {
      disposed = true
      if (createdMap) createdMap.destroy()
      mapRef.current = null
      markersRef.current = []
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const ymaps = window.ymaps3
    if (!map || !ymaps) return
    for (const marker of markersRef.current) map.removeChild(marker)
    markersRef.current = []
    for (const field of fields) {
      const markerElement = document.createElement('button')
      markerElement.type = 'button'
      markerElement.className = 'field-map-marker' + (field.id === activeId ? ' is-active' : '')
      markerElement.style.backgroundColor = colors[field.risk.level]
      markerElement.title = `${field.name} — ${field.crop}, ${field.area_ha} га. Риск: ${field.risk.label}`
      markerElement.setAttribute('aria-label', markerElement.title)
      markerElement.addEventListener('click', () => onSelectRef.current(field.id))
      const marker = new ymaps.YMapMarker({ coordinates: [field.lon, field.lat] }, markerElement)
      map.addChild(marker)
      markersRef.current.push(marker)
    }
  }, [fields, activeId, ready])

  useEffect(() => {
    const map = mapRef.current
    const selected = fields.find(field => field.id === activeId)
    if (map && selected) map.setLocation({ center: [selected.lon, selected.lat], zoom: 11, duration: 700 })
  }, [fields, activeId, ready])

  return <div className="yandex-map-container" ref={container}>
    {error && <div className="yandex-map-error">{error}</div>}
  </div>
}
