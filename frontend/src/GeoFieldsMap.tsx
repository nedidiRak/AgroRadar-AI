import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, Polygon, Polyline, ScaleControl, ZoomControl, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import type { Feature, FeatureCollection, Polygon as GeoPolygon } from 'geojson'
import type { Layer } from 'leaflet'
import 'leaflet/dist/leaflet.css'

type Field = { id:number; name:string; crop:string; area_ha:number; lat:number; lon:number; geometry_source?:string; risk:{level:'high'|'medium'|'low';label:string} }
type Props = {
  fields:Field[]; activeId?:number; onSelect:(id:number)=>void;
  geojson:FeatureCollection<GeoPolygon>|null;
  onSaveGeometry:(fieldId:number, points:[number,number][])=>Promise<boolean>;
}
const colors = { high:'#f87171', medium:'#f6c65b', low:'#62dbad' }
const IMAGE_2024 = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'
const IMAGE_2016 = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg'
const attribution = (year:number) => `EOxCloudless <a href="https://cloudless.eox.at" target="_blank" rel="noopener noreferrer">cloudless.eox.at</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${year === 2024 ? '2024' : '2016 & 2017'})`

function ViewController({fields, activeId, drawing, overviewTick}:{fields:Field[],activeId?:number,drawing:boolean,overviewTick:number}) {
  const map = useMap()
  useEffect(() => {
    if (fields.length) map.fitBounds(fields.map(f => [f.lat,f.lon] as [number,number]), {padding:[65,65], maxZoom:13})
  }, [fields,map])
  useEffect(() => {
    if (drawing) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [drawing,map])
  useEffect(() => {
    if (drawing) return
    const active = fields.find(f => f.id === activeId)
    if (active) map.flyTo([active.lat,active.lon], 14, {animate:true, duration:0.7})
  }, [activeId, fields, map, drawing])
  useEffect(() => {
    if (overviewTick>0 && fields.length) {
      map.fitBounds(fields.map(f=>[f.lat,f.lon] as [number,number]),{padding:[65,65],maxZoom:13})
    }
  },[overviewTick,map])
  return null
}

function DrawEvents({drawing,onPoint}:{drawing:boolean,onPoint:(point:[number,number])=>void}) {
  useMapEvents({click(event) { if (drawing) onPoint([event.latlng.lat,event.latlng.lng]) }})
  return null
}

export default function GeoFieldsMap({fields,activeId,onSelect,geojson,onSaveGeometry}:Props) {
  const [year,setYear] = useState<2016|2024>(2024)
  const [showContours,setShowContours] = useState(true)
  const [drawing,setDrawing] = useState(false)
  const [points,setPoints] = useState<[number,number][]>([])
  const [saving,setSaving] = useState(false)
  const [overviewTick,setOverviewTick] = useState(0)
  const [tileStatus,setTileStatus] = useState<'loading'|'ready'|'error'>('loading')
  const [error,setError] = useState('')
  const byId = useMemo(() => new Map(fields.map(f => [f.id,f])),[fields])
  const activeField = fields.find(f => f.id===activeId)
  const layerKey = fields.map(f=>`${f.id}:${f.risk.level}:${f.geometry_source}`).join('|') + ':' + activeId

  function chooseYear(value:2016|2024) {
    setYear(value); setTileStatus('loading')
  }
  function beginDrawing() {
    if (!activeId) return
    setPoints([]);setDrawing(true);setError('')
  }
  function stopDrawing() {setPoints([]);setDrawing(false);setError('')}
  async function saveDrawing() {
    if (!activeId || points.length < 3 || saving) return
    setSaving(true);setError('')
    try {
      const ok = await onSaveGeometry(activeId,points)
      if (ok) { setDrawing(false);setPoints([]) }
      else setError('Сохранение не удалось. Проверьте сообщение в интерфейсе.')
    } catch(e) { setError(e instanceof Error?e.message:'Ошибка сохранения') }
    finally {setSaving(false)}
  }
  return <div className={`geo-map ${drawing?'geo-map--drawing':''}`} aria-label="Спутниковая карта сельхозполей">
    <MapContainer center={[50.60,36.58]} zoom={11} minZoom={3} maxZoom={17} zoomControl={false} attributionControl className="geo-leaflet-map">
      <TileLayer key={year} url={year===2024?IMAGE_2024:IMAGE_2016} maxNativeZoom={14} maxZoom={17}
        attribution={attribution(year)} eventHandlers={{
          tileload:()=>setTileStatus(old=>old==='ready'?old:'ready'),
          tileerror:()=>setTileStatus(old=>old==='ready'?old:'error')
        }}/>
      <ViewController fields={fields} activeId={activeId} drawing={drawing} overviewTick={overviewTick}/>
      <DrawEvents drawing={drawing} onPoint={point=>setPoints(previous=>previous.length>=500?previous:[...previous,point])}/>
      {geojson && showContours && <GeoJSON key={layerKey} data={geojson} interactive={!drawing}
        style={(feature) => {
          const f=byId.get(Number(feature?.properties?.field_id))
          const color=colors[f?.risk.level??'low']
          const demo=feature?.properties?.geometry_source==='demo_generated'
          return {color,weight:f?.id===activeId?3.5:2.3, fillColor:color,
            fillOpacity:f?.id===activeId?0.24:0.12, dashArray:demo?'7 6':undefined}
        }} onEachFeature={(feature:Feature,layer:Layer)=>{
          const id=Number(feature.properties?.field_id)
          const f=byId.get(id)
          if(f){
            layer.on('click',()=>onSelect(id))
            layer.bindTooltip(`<strong>${f.name}</strong><br/>${f.crop} · ${f.area_ha} га<br/>${feature.properties?.geometry_source==='demo_generated'?'Примерный контур':'Контур пользователя'}`,{sticky:true})
          }
        }}/>} 
      {fields.map(f=><CircleMarker key={f.id} center={[f.lat,f.lon]} radius={f.id===activeId?10:7}
        interactive={!drawing}
        pathOptions={{color:'#ffffff',weight:2.2,fillColor:colors[f.risk.level],fillOpacity:1}}
        eventHandlers={{click:()=>onSelect(f.id)}}>
        <Tooltip direction="top" offset={[0,-10]}>{f.name} · {f.crop}</Tooltip>
      </CircleMarker>)}
      {drawing && points.length>0 && <Polyline positions={points} interactive={false} pathOptions={{color:'#4fffb8',weight:3,dashArray:'6 5'}}/>}
      {drawing && points.length>=3 && <Polygon positions={points} interactive={false} pathOptions={{color:'#4fffb8',fillColor:'#4fffb8',fillOpacity:0.17,weight:2}}/>}
      {drawing && points.map((p,i)=><CircleMarker key={i} center={p} radius={4.5} interactive={false} pathOptions={{color:'#ffffff',weight:1.5,fillColor:'#4fffb8',fillOpacity:1}}/>)}
      <ZoomControl position="bottomleft"/><ScaleControl position="bottomleft" metric imperial={false}/>
    </MapContainer>
    <div className="map-topbar">
      <div className="map-source-tag"><span className="map-source-dot"/> СПУТНИК · SENTINEL‑2</div>
      <div className="map-layer-switch" role="group" aria-label="Слои спутниковой карты">
        <button className={year===2024?'chosen':''} onClick={()=>chooseYear(2024)} type="button">Снимки 2024</button>
        <button className={year===2016?'chosen':''} onClick={()=>chooseYear(2016)} type="button">Архив 2016</button>
      </div>
    </div>
    <div className="map-side-controls"><button onClick={()=>setOverviewTick(x=>x+1)} type="button" title="Показать все поля">⊞ <span>Все поля</span></button>
      <button onClick={()=>setShowContours(x=>!x)} className={showContours?'selected':''} title="Показать или скрыть границы полей" type="button">{showContours?'◈':'◇'} <span>Контуры</span></button>
      {!drawing && <button onClick={beginDrawing} disabled={!activeId} type="button" title="Обвести выбранное поле мышью">✎ <span>Обвести поле</span></button>}
    </div>
    {drawing && <div className="map-draw-bar">
      <div><strong>Рисуем: {activeField?.name}</strong><span>Щёлкай по углам поля на снимке. Минимум 3 точки.</span></div>
      <div className="map-draw-actions">
        <button type="button" onClick={()=>setPoints(p=>p.slice(0,-1))} disabled={!points.length||saving}>↶ Отменить точку</button>
        <button type="button" onClick={stopDrawing} disabled={saving}>Отмена</button>
        <button type="button" className="map-save" onClick={()=>void saveDrawing()} disabled={points.length<3||saving}>{saving?'Сохраняем…':`✓ Сохранить (${points.length})`}</button>
      </div>
    </div>}
    {tileStatus==='error' && <div className="map-network-warning">Не удалось загрузить часть спутниковых снимков. Проверь подключение к интернету.</div>}
    {error && <div className="map-draw-error">{error}</div>}
    {!drawing && <div className="map-hint">{activeField?.geometry_source==='user_drawn'?'Граница поля сохранена на сервере':'Пунктир — демонстрационный контур. Обведи настоящее поле на снимке.'}</div>}
  </div>
}
