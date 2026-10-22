"""AgroRadar AI — field geodata + cached OpenWeather observations/forecast.

The four bundled fields are fictional examples. Their polygons are GENERATED examples,
not surveyed cadastral boundaries. Replace the GeoJSON before production use.
"""
import asyncio
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
app = FastAPI(title='AgroRadar AI API', version='0.4.0')
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    allow_methods=['GET'], allow_headers=['*'],
)

# Fictional fields; coordinates are illustrative and not a record of actual farms.
FIELDS = [
    {'id': 1, 'name': 'Поле Северное', 'crop': 'Пшеница', 'area_ha': 124, 'lat': 50.612, 'lon': 36.578},
    {'id': 2, 'name': 'Поле Восточное', 'crop': 'Подсолнечник', 'area_ha': 87, 'lat': 50.635, 'lon': 36.653},
    {'id': 3, 'name': 'Поле Южное', 'crop': 'Кукуруза', 'area_ha': 156, 'lat': 50.563, 'lon': 36.613},
    {'id': 4, 'name': 'Поле Западное', 'crop': 'Соя', 'area_ha': 93, 'lat': 50.592, 'lon': 36.505},
]
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
    for field in FIELDS:
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


def make_feature(field: dict, index: int) -> dict:
    return {'type': 'Feature', 'id': field['id'], 'properties': {
        'field_id': field['id'], 'name': field['name'], 'crop': field['crop'],
        'area_ha': field['area_ha'], 'geometry_source': 'demo_generated',
        'geometry_accuracy': 'illustrative_not_surveyed',
    }, 'geometry': {'type': 'Polygon', 'coordinates': [_approx_demo_ring(field, index)]}}


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
    return {'weather': {**DEMO_WEATHER[field['id']], 'source': 'demo', 'observed_at': None},
            'forecast': {'min_temperature_next_24h_c': DEMO_FORECAST_MINIMUM[field['id']],
                         'source': 'demo', 'sample_count': 0, 'period_hours': 24}}


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
        # 3-hour forecast covers future windows; use next available data if no sample in interval.
        if not timestamps:
            raise ValueError('В прогнозе нет точек на ближайшие 24 часа')
        minimum = round(min(float(entry['main']['temp_min']) for entry in timestamps), 1)
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
                         'sample_count': len(timestamps), 'period_hours': 24},
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
    return {'status': 'ok', 'version': '0.4.0',
            'weather_mode': 'live' if os.getenv('OPENWEATHER_API_KEY', '').strip() else 'demo'}


@app.get('/api/fields')
def fields():
    return FIELDS


@app.get('/api/fields.geojson')
def fields_geojson():
    return {'type': 'FeatureCollection', 'features': [make_feature(field, index)
                                                    for index, field in enumerate(FIELDS)],
            'metadata': {'geometry_source': 'demo_generated', 'crs': 'EPSG:4326',
                         'notice': 'Это примерные геометрии вымышленных полей, не кадастровые границы.'}}


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
    results = await asyncio.gather(*(compose_field(field) for field in FIELDS))
    return {'fields': results, 'count': len(results),
            'high_risk_count': sum(field['risk']['level'] == 'high' for field in results),
            'mode': 'demo' if not os.getenv('OPENWEATHER_API_KEY', '').strip() else 'live_forecast'}
