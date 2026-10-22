import { useEffect, useMemo } from 'react'
import { CircleMarker, GeoJSON, MapContainer, ScaleControl, Tooltip, useMap } from 'react-leaflet'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import type { Layer } from 'leaflet'
import 'leaflet/dist/leaflet.css'

type Field = { id:number; name:string; crop:string; area_ha:number; lat:number; lon:number; risk:{level:'high'|'medium'|'low';label:string} }
type Props = { fields:Field[]; activeId?:number; onSelect:(id:number)=>void; geojson:FeatureCollection<Polygon>|null }
const colors = { high:'#ef6666', medium:'#e8b74f', low:'#56c6a0' }

function ViewController({fields, activeId}:{fields:Field[],activeId?:number}) {
  const map = useMap()
  useEffect(() => {
    if(fields.length) {
      map.fitBounds(fields.map(f => [f.lat,f.lon] as [number,number]), {padding:[45,45], maxZoom:12})
    }
  }, [fields, map])
  useEffect(() => {
    const active = fields.find(f => f.id === activeId)
    if(active) map.panTo([active.lat,active.lon], {animate:true, duration:0.5})
  }, [activeId,fields,map])
  return null
}

export default function GeoFieldsMap({fields,activeId,onSelect,geojson}:Props) {
  const byId = useMemo(() => new Map(fields.map(f=>[f.id,f])), [fields])
  // Re-create the GeoJSON layer after risk/selection changes so its styles stay consistent.
  const layerKey = fields.map(f=>`${f.id}:${f.risk.level}`).join('|') + ':' + activeId
  return <div className="geo-map" aria-label="Координатная карта полей">
    <div className="geo-map-label"><strong>ГЕОКАРТА · ОФЛАЙН</strong><span>WGS84 / EPSG:4326 · демонстрационные контуры</span></div>
    <MapContainer center={[50.60,36.58]} zoom={10} minZoom={7} maxZoom={17} zoomControl={true} attributionControl={false} className="geo-leaflet-map">
      <ViewController fields={fields} activeId={activeId}/>
      {geojson && <GeoJSON key={layerKey} data={geojson} style={(feature) => {
        const f = byId.get(Number(feature?.properties?.field_id))
        const color = colors[f?.risk.level ?? 'low']
        return {color, weight:f?.id===activeId ? 4:2, fillColor:color,
                fillOpacity:f?.id===activeId ? 0.44:0.23, dashArray:f?.id===activeId ? undefined:'5 5'}
      }} onEachFeature={(feature:Feature, layer:Layer) => {
        const id = Number(feature.properties?.field_id)
        const f = byId.get(id)
        if (f) {
          layer.on('click', () => onSelect(id))
          layer.bindTooltip(`${f.name} · ${f.area_ha} га`, {sticky:true})
        }
      }}/>} 
      {fields.map(f=><CircleMarker key={f.id} center={[f.lat,f.lon]} radius={f.id===activeId?11:8}
        pathOptions={{color:'#eaffee', weight:2, fillColor:colors[f.risk.level], fillOpacity:1}}
        eventHandlers={{click:()=>onSelect(f.id)}}>
        <Tooltip direction="top" offset={[0,-8]} permanent={false}>{f.name} · {f.crop} · {f.area_ha} га</Tooltip>
      </CircleMarker>)}
      <ScaleControl position="bottomleft" metric={true} imperial={false}/>
    </MapContainer>
    <div className="geo-map-notice">Контуры рассчитаны по примерной площади и центру поля. Для реального хозяйства загружается GeoJSON с измеренными границами.</div>
  </div>
}
