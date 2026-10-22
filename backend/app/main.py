"""AgroRadar AI — field geodata + cached OpenWeather observations/forecast.

The four bundled fields are fictional examples. Their polygons are GENERATED examples,
not surveyed cadastral boundaries. Replace the GeoJSON before production use.
"""
import asyncio
import json
import math
import os
import time
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
app = FastAPI(title='AgroRadar AI API', version='1.1.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    allow_methods=['GET', 'POST', 'PUT', 'DELETE'], allow_headers=['*'],
)

# Fictional fields; coordinates are illustrative and not a record of actual farms.
FIELDS = [
    {'id': 1, 'name': 'Поле Северное', 'crop': 'Пшеница', 'area_ha': 124, 'lat': 50.612, 'lon': 36.578},
    {'id': 2, 'name': 'Поле Восточное', 'crop': 'Подсолнечник', 'area_ha': 87, 'lat': 50.635, 'lon': 36.653},
    {'id': 3, 'name': 'Поле Южное', 'crop': 'Кукуруза', 'area_ha': 156, 'lat': 50.563, 'lon': 36.613},
    {'id': 4, 'name': 'Поле Западное', 'crop': 'Соя', 'area_ha': 93, 'lat': 50.592, 'lon': 36.505},
]

# Saved user-traced polygons are persisted separately from demo geometry.
GEOMETRY_FILE = Path(__file__).resolve().parents[1] / 'data' / 'field_geometries.json'
CATALOG_FILE = Path(__file__).resolve().parents[1] / 'data' / 'fields.json'
CATALOG_LOCK = threading.RLock()

class GeometryUpdate(BaseModel):
    coordinates: list[list[float]]


class FieldMetadata(BaseModel):
    name: str
    crop: str
    description: str = ''


class FieldCreate(FieldMetadata):
    # GeoJSON coordinate order: longitude, latitude.
    coordinates: list[list[float]]


def normalise_metadata(payload: FieldMetadata) -> dict:
    name = payload.name.strip()
    crop = payload.crop.strip()
    description = payload.description.strip()
    if not 1 <= len(name) <= 100:
        raise HTTPException(422, 'Название поля должно содержать от 1 до 100 символов')
    if not 1 <= len(crop) <= 80:
        raise HTTPException(422, 'Укажи культуру (до 80 символов)')
    if len(description) > 2000:
        raise HTTPException(422, 'Описание не должно превышать 2000 символов')
    return {'name': name, 'crop': crop, 'description': description}


def read_catalog() -> dict:
    # Backward-compatible: do not erase old four fields or old saved GeoJSON.
    # Once fields.json exists, it is authoritative, including deletions.
    if not CATALOG_FILE.exists():
        return {'version': 1, 'next_id': 5,
                'fields': [{**field, 'description': '', 'kind': 'demo'} for field in FIELDS]}
    try:
        catalog = json.loads(CATALOG_FILE.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(500, 'Каталог полей повреждён. Восстанови fields.json из резервной копии.') from exc
    if (not isinstance(catalog, dict) or not isinstance(catalog.get('fields'), list)
            or not isinstance(catalog.get('next_id'), int)):
        raise HTTPException(500, 'Неверный формат каталога fields.json')
    return catalog


def save_catalog(catalog: dict) -> None:
    CATALOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = CATALOG_FILE.with_name(CATALOG_FILE.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
        temporary.replace(CATALOG_FILE)
    finally:
        temporary.unlink(missing_ok=True)


def assert_unique_name(fields: list[dict], name: str, exclude_id: int | None = None) -> None:
    if any(field['id'] != exclude_id and field['name'].casefold() == name.casefold()
           for field in fields):
        raise HTTPException(409, 'Поле с таким названием уже существует')


def all_geometries() -> dict:
    # Prefer canonical new catalog geometry, preserve legacy v0.5 saved overrides.
    stored = stored_geometries()
    for field in read_catalog()['fields']:
        if field.get('coordinates'):
            stored[str(field['id'])] = {'coordinates': field['coordinates']}
    return stored


def stored_geometries() -> dict:
    if not GEOMETRY_FILE.exists():
        return {}
    try:
        data = json.loads(GEOMETRY_FILE.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError) as exc:
        raise HTTPException(500, 'Файл сохранённых границ повреждён или недоступен') from exc
    if not isinstance(data, dict):
        raise HTTPException(500, 'Неверный формат данных геометрии')
    return data


def save_geometries(data: dict) -> None:
    GEOMETRY_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = GEOMETRY_FILE.with_suffix('.tmp')
    temp_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    temp_file.replace(GEOMETRY_FILE)


def polygon_area_center(ring: list[list[float]]) -> tuple[float, float, float]:
    """Approximate small parcel area and centroid in a local equirectangular projection."""
    avg_lat = sum(point[1] for point in ring[:-1]) / (len(ring)-1)
    cos_lat = math.cos(math.radians(avg_lat))
    xy = [(math.radians(lon) * 6371008.8 * cos_lat,
           math.radians(lat) * 6371008.8) for lon, lat in ring]
    doubled = 0.0
    center_x, center_y = 0.0, 0.0
    for (x1, y1), (x2, y2) in zip(xy, xy[1:]):
        cross = x1*y2 - x2*y1
        doubled += cross
        center_x += (x1+x2)*cross
        center_y += (y1+y2)*cross
    if abs(doubled) < 1:
        raise HTTPException(422, 'Площадь контура слишком мала')
    center_lon = math.degrees((center_x / (3*doubled)) / (6371008.8*cos_lat))
    center_lat = math.degrees((center_y / (3*doubled)) / 6371008.8)
    return abs(doubled)/2/10000, center_lat, center_lon


def _segments_intersect(a, b, c, d) -> bool:
    def cross(p, q, r):
        return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    o1, o2 = cross(a,b,c), cross(a,b,d)
    o3, o4 = cross(c,d,a), cross(c,d,b)
    return ((o1 > 0 > o2 or o1 < 0 < o2) and
            (o3 > 0 > o4 or o3 < 0 < o4))


def validate_ring(coords: list[list[float]]) -> list[list[float]]:
    if not 3 <= len(coords) <= 501:
        raise HTTPException(422, 'Нужно от 3 до 500 вершин')
    ring = []
    for point in coords:
        if len(point) != 2 or not all(math.isfinite(value) for value in point):
            raise HTTPException(422, 'Каждая вершина должна иметь конечные lon и lat')
        lon, lat = point
        if not -180 <= lon <= 180 or not -85 <= lat <= 85:
            raise HTTPException(422, 'Координаты вне допустимых пределов')
        if not ring or ring[-1] != [lon, lat]:
            ring.append([lon, lat])
    if ring[0] == ring[-1]:
        ring.pop()
    if len(ring) < 3:
        raise HTTPException(422, 'Необходимо хотя бы три разные вершины')
    ring.append(ring[0][:])
    edge_count = len(ring)-1
    for i in range(edge_count):
        for j in range(i+1, edge_count):
            if j == i+1 or (i==0 and j==edge_count-1):
                continue
            if _segments_intersect(ring[i], ring[i+1], ring[j], ring[j+1]):
                raise HTTPException(422, 'Контур пересекает сам себя')
    area, _, _ = polygon_area_center(ring)
    if area > 100000:
        raise HTTPException(422, 'Контур слишком большой: проверьте координаты')
    return ring


def effective_fields() -> list[dict]:
    stored = all_geometries()
    result = []
    for record in read_catalog()['fields']:
        # The polygon is exported only as GeoJSON, not repeated in weather dashboard.
        field = {key: value for key, value in record.items() if key != 'coordinates'}
        field.setdefault('description', '')
        field.setdefault('kind', 'demo')
        override = stored.get(str(field['id']))
        if override:
            ring = override['coordinates']
            area, lat, lon = polygon_area_center(ring)
            field.update(area_ha=round(area, 2), lat=round(lat, 6), lon=round(lon, 6),
                         geometry_source='user_drawn')
        else:
            field['geometry_source'] = 'demo_generated'
        result.append(field)
    return result

DEMO_WEATHER = {
    1: {'temperature_c': -2.0, 'humidity_pct': 83, 'wind_ms': 3.1},
    2: {'temperature_c': 2.1, 'humidity_pct': 71, 'wind_ms': 4.0},
    3: {'temperature_c': 8.4, 'humidity_pct': 58, 'wind_ms': 2.4},
    4: {'temperature_c': 5.3, 'humidity_pct': 66, 'wind_ms': 5.0},
}
# Demo minimum over next 24 h, deliberately independent from the observed temperature.
DEMO_FORECAST_MINIMUM = {1: -3.6, 2: 1.4, 3: 4.8, 4: 2.6}
_CACHE: dict[tuple, tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = 900  # 15 minutes; in production use Redis/shared caching.


def find_field(field_id: int) -> dict:
    for field in effective_fields():
        if field['id'] == field_id:
            return field
    raise HTTPException(status_code=404, detail='Поле не найдено')


def _approx_demo_ring(field: dict, variation: int) -> list[list[float]]:
    """Illustrative polygons anchored in WGS84 (lon,lat), not real field borders.

    Dimensions use reported hectares to set a plausible bounding rectangle.
    These geometries must never be interpreted as surveyed boundaries.
    """
    area_sq_m = field['area_ha'] * 10_000
    ratio = [1.5, 1.1, 1.7, 1.25][variation]
    width_m, height_m = math.sqrt(area_sq_m * ratio), math.sqrt(area_sq_m / ratio)
    lon_m = 111_320 * math.cos(math.radians(field['lat']))
    lat_m = 111_320
    dx, dy = width_m / (2 * lon_m), height_m / (2 * lat_m)
    cx, cy = field['lon'], field['lat']
    return [[round(cx-dx, 7), round(cy-dy, 7)],
            [round(cx+dx, 7), round(cy-dy, 7)],
            [round(cx+dx, 7), round(cy+dy, 7)],
            [round(cx-dx, 7), round(cy+dy, 7)],
            [round(cx-dx, 7), round(cy-dy, 7)]]


def make_feature(field: dict, index: int, stored: dict) -> dict:
    own = stored.get(str(field['id']))
    ring = own['coordinates'] if own else _approx_demo_ring(field, index % 4)
    return {'type': 'Feature', 'id': field['id'], 'properties': {
        'field_id': field['id'], 'name': field['name'], 'crop': field['crop'],
        'description': field.get('description', ''), 'kind': field.get('kind', 'demo'),
        'area_ha': field['area_ha'], 'geometry_source': 'user_drawn' if own else 'demo_generated',
        'geometry_accuracy': 'user_traced_not_surveyed' if own else 'illustrative_not_surveyed',
    }, 'geometry': {'type': 'Polygon', 'coordinates': [ring]}}


def risk_from_temperature(min_temp_c: float, basis: str) -> dict:
    # Screening temperature thresholds, not validated crop damage or frost probability.
    if min_temp_c <= 0:
        level, label, reason = ('high', 'Высокий', 'Ожидается температура 0 °C или ниже: проверьте риск заморозка.')
    elif min_temp_c <= 3:
        level, label, reason = ('medium', 'Умеренный', 'Ожидается +0…+3 °C: рекомендуется наблюдение за прогнозом.')
    else:
        level, label, reason = ('low', 'Низкий', 'По температурному порогу заморозок не выявлен.')
    return {'level': level, 'label': label, 'reason': reason, 'basis': basis,
            'min_temperature_next_24h_c': min_temp_c,
            'rule': '<=0 °C: высокий; (0,3] °C: умеренный; >3 °C: низкий'}


def _demo_data(field: dict) -> dict:
    # Synthetic time-series is visibly tagged DEMO throughout the UI; it is not a weather prediction.
    sample = DEMO_WEATHER.get(field['id'], {'temperature_c': 8.0, 'humidity_pct': 65, 'wind_ms': 3.0})
    current = sample['temperature_c']
    minimum = DEMO_FORECAST_MINIMUM.get(field['id'], 4.2)
    offsets = [0, .2, .5, .85, 1, .65, .38, .14]
    now = int(datetime.now(timezone.utc).timestamp())
    start = (now // 10800 + 1) * 10800  # align 3-hourly example timestamps
    points = [{'timestamp': start + index * 10800,
               'temperature_c': round(current + (minimum - current) * factor, 1),
               'precipitation_probability_pct': None,
               'rain_mm_3h': None}
              for index, factor in enumerate(offsets)]
    return {'weather': {**sample, 'source': 'demo', 'observed_at': None},
            'forecast': {'min_temperature_next_24h_c': minimum,
                         'source': 'demo', 'sample_count': len(points),
                         'period_hours': 24, 'points': points}}


async def _openweather_request(endpoint: str, field: dict, key: str) -> dict:
    cache_key = (endpoint, round(field['lat'], 4), round(field['lon'], 4))
    cached = _CACHE.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get('https://api.openweathermap.org/data/2.5/' + endpoint,
                                    params={'lat': field['lat'], 'lon': field['lon'],
                                            'appid': key, 'units': 'metric', 'lang': 'ru'})
        response.raise_for_status()
        data = response.json()
    _CACHE[cache_key] = (time.monotonic() + _CACHE_TTL_SECONDS, data)
    return data


async def field_conditions(field: dict) -> dict:
    key = os.getenv('OPENWEATHER_API_KEY', '').strip()
    if not key:
        return _demo_data(field)
    try:
        current, future = await asyncio.gather(
            _openweather_request('weather', field, key),
            _openweather_request('forecast', field, key),
        )
        now = datetime.now(timezone.utc).timestamp()
        timestamps = [entry for entry in future['list']
                      if now <= float(entry['dt']) <= now + 24 * 3600]
        # Values are from three-hour forecast intervals; they are NOT field observations.
        if not timestamps:
            raise ValueError('В прогнозе нет точек на ближайшие 24 часа')
        timestamps.sort(key=lambda entry: entry['dt'])
        minimum = round(min(float(entry['main']['temp_min']) for entry in timestamps), 1)
        points = []
        for entry in timestamps:
            probability = entry.get('pop')
            rain = entry.get('rain') or {}
            points.append({
                'timestamp': int(entry['dt']),
                'temperature_c': round(float(entry['main']['temp']), 1),
                'precipitation_probability_pct': (
                    round(max(0, min(1, float(probability))) * 100)
                    if probability is not None else None
                ),
                'rain_mm_3h': round(float(rain.get('3h', 0)), 2),
            })
        return {
            'weather': {
                'temperature_c': round(float(current['main']['temp']), 1),
                'humidity_pct': int(current['main']['humidity']),
                'wind_ms': round(float(current.get('wind', {}).get('speed', 0)), 1),
                'source': 'openweather_current',
                'observed_at': datetime.fromtimestamp(int(current['dt']), timezone.utc).isoformat(),
            },
            'forecast': {'min_temperature_next_24h_c': minimum,
                         'source': 'openweather_forecast_3h',
                         'sample_count': len(timestamps), 'period_hours': 24,
                         'points': points},
        }
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError) as exc:
        # Never silently invent live weather when the provider returns an error.
        raise HTTPException(status_code=503, detail=(
            'OpenWeather недоступен или ключ не принят. Проверьте OPENWEATHER_API_KEY. '
            'Для офлайн-демо удалите ключ из backend/.env и перезапустите сервер.'
        )) from exc


async def compose_field(field: dict) -> dict:
    conditions = await field_conditions(field)
    forecast = conditions['forecast']
    return {**field, **conditions,
            'risk': risk_from_temperature(forecast['min_temperature_next_24h_c'],
                                          'forecast_24h' if forecast['source'] != 'demo' else 'demo_forecast_24h')}


@app.get('/api/health')
def health():
    return {'status': 'ok', 'version': '1.1.0',
            'weather_mode': 'live' if os.getenv('OPENWEATHER_API_KEY', '').strip() else 'demo'}


@app.get('/api/fields')
def fields():
    return effective_fields()


@app.get('/api/fields.geojson')
def fields_geojson():
    stored = all_geometries()
    return {'type': 'FeatureCollection',
            'features': [make_feature(field, index, stored)
                         for index, field in enumerate(effective_fields())],
            'metadata': {'crs': 'EPSG:4326',
                         'notice': 'Демо-границы приблизительны. Нарисованные контуры — пользовательские, не кадастровые.'}}


@app.get('/api/fields/{field_id}')
def field_detail(field_id: int):
    return find_field(field_id)


@app.get('/api/fields/{field_id}/weather')
async def field_weather(field_id: int):
    return (await field_conditions(find_field(field_id)))['weather']


@app.get('/api/fields/{field_id}/forecast')
async def field_forecast(field_id: int):
    return (await field_conditions(find_field(field_id)))['forecast']


@app.get('/api/fields/{field_id}/risks')
async def field_risks(field_id: int):
    details = await compose_field(find_field(field_id))
    return {'field_id': field_id, 'risk_type': 'frost_temperature_screening_24h',
            'risk': details['risk'], 'weather': details['weather'], 'forecast': details['forecast'],
            'disclaimer': 'Температурный скрининг, не оценка ущерба культуре. Нужны культура, фаза и локальные условия.'}


@app.get('/api/dashboard')
async def dashboard():
    results = await asyncio.gather(*(compose_field(field) for field in effective_fields()))
    return {'fields': results, 'count': len(results),
            'high_risk_count': sum(field['risk']['level'] == 'high' for field in results),
            'mode': 'demo' if not os.getenv('OPENWEATHER_API_KEY', '').strip() else 'live_forecast'}


@app.post('/api/fields', status_code=status.HTTP_201_CREATED)
def create_field(payload: FieldCreate):
    meta = normalise_metadata(payload)
    ring = validate_ring(payload.coordinates)
    area, lat, lon = polygon_area_center(ring)
    with CATALOG_LOCK:
        catalog = read_catalog()
        assert_unique_name(catalog['fields'], meta['name'])
        field_id = max(catalog['next_id'], max((f['id'] for f in catalog['fields']), default=0) + 1)
        catalog['next_id'] = field_id + 1
        catalog['fields'].append({
            'id': field_id, **meta, 'kind': 'user', 'area_ha': round(area, 2),
            'lat': round(lat, 6), 'lon': round(lon, 6), 'coordinates': ring,
        })
        save_catalog(catalog)
        _CACHE.clear()
    return {'created': True, 'field': find_field(field_id)}


@app.put('/api/fields/{field_id}')
def edit_field(field_id: int, payload: FieldMetadata):
    meta = normalise_metadata(payload)
    with CATALOG_LOCK:
        catalog = read_catalog()
        assert_unique_name(catalog['fields'], meta['name'], exclude_id=field_id)
        target = next((f for f in catalog['fields'] if f['id'] == field_id), None)
        if target is None:
            raise HTTPException(404, 'Поле не найдено')
        target.update(meta)
        save_catalog(catalog)
    return {'saved': True, 'field': find_field(field_id)}


@app.delete('/api/fields/{field_id}')
def delete_field(field_id: int):
    with CATALOG_LOCK:
        catalog = read_catalog()
        if not any(f['id'] == field_id for f in catalog['fields']):
            raise HTTPException(404, 'Поле не найдено')
        catalog['fields'] = [f for f in catalog['fields'] if f['id'] != field_id]
        save_catalog(catalog)  # authoritative: deletion survives a server restart
        # Legacy geometries are safe even if they remain orphaned, since IDs are never reused.
        _CACHE.clear()
    return {'deleted': True, 'field_id': field_id}


@app.put('/api/fields/{field_id}/geometry')
def update_field_geometry(field_id: int, payload: GeometryUpdate):
    ring = validate_ring(payload.coordinates)
    with CATALOG_LOCK:
        catalog = read_catalog()
        target = next((f for f in catalog['fields'] if f['id'] == field_id), None)
        if target is None:
            raise HTTPException(404, 'Поле не найдено')
        area, lat, lon = polygon_area_center(ring)
        target.update(coordinates=ring, area_ha=round(area, 2),
                      lat=round(lat, 6), lon=round(lon, 6))
        save_catalog(catalog)
        _CACHE.clear()
    return {'saved': True, 'field_id': field_id,
            'feature': make_feature(find_field(field_id), 0, all_geometries())}


@app.delete('/api/fields/{field_id}/geometry')
def reset_field_geometry(field_id: int):
    with CATALOG_LOCK:
        catalog = read_catalog()
        target = next((f for f in catalog['fields'] if f['id'] == field_id), None)
        if target is None:
            raise HTTPException(404, 'Поле не найдено')
        if target.get('kind') == 'user':
            raise HTTPException(409, 'У созданного поля нет демонстрационной границы. Используй «Изменить контур».')
        target.pop('coordinates', None)
        original = next((f for f in FIELDS if f['id'] == field_id), None)
        if original:
            target.update(lat=original['lat'], lon=original['lon'], area_ha=original['area_ha'])
        save_catalog(catalog)
        legacy = stored_geometries()
        if str(field_id) in legacy:
            legacy.pop(str(field_id))
            save_geometries(legacy)
        _CACHE.clear()
    return {'restored_demo_geometry': True, 'field_id': field_id}


# Isolated DeepSeek integration; existing maps, fields and weather endpoints unchanged.
from .ai_assistant import build_ai_router
app.include_router(build_ai_router(find_field, compose_field))
