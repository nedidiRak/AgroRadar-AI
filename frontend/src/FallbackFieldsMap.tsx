/** Read-only fallback when a browser/Yandex API key cannot load the normal map.
 * Polygon boundaries remain visible even if OSM tiles are temporarily unavailable.
 * Never enables geometry editing, which remains exclusive to the Yandex map.
 */
import { useEffect, useMemo } from 'react'
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { FeatureCollection, Polygon as GeoPolygon } from 'geojson'
import type { LatLngTuple } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './FallbackFieldsMap.css'

type Risk = 'high' | 'medium' | 'low' | 'unknown'
type Field = {
  id: number; name: string; crop: string; area_ha: number
  lat: number; lon: number; risk: { level: Risk; label: string }
}
type Props = {
  fields: Field[]; activeId?: number; onSelect: (id: number) => void
  geojson: FeatureCollection<GeoPolygon> | null; showContours: boolean
}
const colors: Record<Risk,string> = {
  high: '#f87171', medium: '#f6c65b', low: '#62dbad', unknown: '#94a3b8',
}

function FitFields({ fields }: {fields: Field[]}) {
  const map = useMap()
  const points = useMemo<LatLngTuple[]>(() => fields.filter(f =>
    Number.isFinite(f.lat) && Number.isFinite(f.lon)
  ).map(f => [f.lat,f.lon]), [fields])
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) map.setView(points[0], 12)
    else map.fitBounds(points, {padding:[24,24], maxZoom:13})
    map.invalidateSize()
  }, [map,points])
  useEffect(() => {
    const node = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(node)
    return () => observer.disconnect()
  }, [map])
  return null
}

export default function FallbackFieldsMap({fields,activeId,onSelect,geojson,showContours}:Props) {
  const byId = useMemo(() => new Map(fields.map(f=>[f.id,f])), [fields])
  const center:LatLngTuple = fields.length ? [fields[0].lat,fields[0].lon] : [50.6,36.58]
  return <div className="agr-fallback-map" aria-label="Резервная карта полей OpenStreetMap">
    <MapContainer center={center} zoom={11} zoomControl scrollWheelZoom style={{height:'100%',width:'100%'}}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; участники OpenStreetMap"/>
      <FitFields fields={fields}/>
      {showContours && geojson?.features.map(feature => {
        if (feature.geometry?.type !== 'Polygon') return null
        const id=Number(feature.properties?.field_id)
        const field=byId.get(id)
        if (!field) return null
        const ring = feature.geometry.coordinates[0] ?? []
        const positions: LatLngTuple[] = ring.filter(point =>
          point.length>=2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
        ).map(([lon,lat]) => [lat,lon])
        if (positions.length<3) return null
        return <Polygon key={`p-${id}`} positions={positions}
          pathOptions={{
            color:colors[field.risk.level],
            weight:activeId===id?4:2,
            fillColor:colors[field.risk.level],
            fillOpacity:activeId===id?.32:.16,
          }}
          eventHandlers={{click:()=>onSelect(id)}}>
          <Tooltip>{field.name} · {field.crop} · {field.risk.label}</Tooltip>
        </Polygon>
      })}
      {fields.filter(f=>Number.isFinite(f.lat)&&Number.isFinite(f.lon)).map(field =>
        <CircleMarker key={field.id} center={[field.lat,field.lon]}
          radius={activeId===field.id?8:6}
          pathOptions={{color:'#133427',weight:2,fillColor:colors[field.risk.level],fillOpacity:1}}
          eventHandlers={{click:()=>onSelect(field.id)}}>
          <Tooltip>{field.name} · {field.crop} · {field.area_ha} га</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  </div>
}
