import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
app = FastAPI(title='AgroRadar AI API', version='0.1.0')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'], allow_credentials=False, allow_methods=['GET'], allow_headers=['*'])

# All sample fields and sample weather values are fictional, for demo only.
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


def find_field(field_id: int):
    field = next((item for item in FIELDS if item['id'] == field_id), None)
    if field is None:
        raise HTTPException(status_code=404, detail='Поле не найдено')
    return field


def frost_risk(temperature_c: float):
    # DEMO ONLY: ambient temperature threshold, not validated crop damage prediction.
    if temperature_c < 0:
        return {'level': 'high', 'label': 'Высокий', 'reason': 'Температура ниже 0 °C: возможны условия заморозка.'}
    if temperature_c <= 3:
        return {'level': 'medium', 'label': 'Умеренный', 'reason': 'Температура от 0 до +3 °C: стоит следить за прогнозом.'}
    return {'level': 'low', 'label': 'Низкий', 'reason': 'По температурному порогу признаков заморозка нет.'}


async def get_weather(field):
    key = os.getenv('OPENWEATHER_API_KEY', '').strip()
    if not key:
        return {**DEMO_WEATHER[field['id']], 'source': 'demo', 'observed_at': None}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get('https://api.openweathermap.org/data/2.5/weather', params={
                'lat': field['lat'], 'lon': field['lon'], 'appid': key, 'units': 'metric', 'lang': 'ru'
            })
            response.raise_for_status()
            data = response.json()
        return {
            'temperature_c': round(float(data['main']['temp']), 1),
            'humidity_pct': int(data['main']['humidity']),
            'wind_ms': float(data.get('wind', {}).get('speed', 0)),
            'source': 'openweather_current',
            'observed_at': datetime.fromtimestamp(data['dt'], tz=timezone.utc).isoformat()
        }
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=503, detail='Погодный сервис недоступен. Проверьте ключ API и соединение.') from exc


@app.get('/api/health')
def health():
    return {'status': 'ok', 'version': '0.1.0'}


@app.get('/api/fields')
def fields():
    return FIELDS


@app.get('/api/fields/{field_id}')
def field_detail(field_id: int):
    return find_field(field_id)


@app.get('/api/fields/{field_id}/weather')
async def field_weather(field_id: int):
    return await get_weather(find_field(field_id))


@app.get('/api/fields/{field_id}/risks')
async def field_risks(field_id: int):
    field = find_field(field_id)
    weather = await get_weather(field)
    return {'field_id': field_id, 'risk_type': 'frost_temperature_screening',
            'risk': frost_risk(weather['temperature_c']), 'weather': weather,
            'disclaimer': 'Предварительный температурный индикатор, не прогноз повреждения культуры.'}


@app.get('/api/dashboard')
async def dashboard():
    results = []
    for field in FIELDS:
        weather = await get_weather(field)
        results.append({**field, 'weather': weather, 'risk': frost_risk(weather['temperature_c'])})
    return {'fields': results, 'count': len(results),
            'high_risk_count': sum(item['risk']['level'] == 'high' for item in results),
            'mode': 'demo' if all(item['weather']['source'] == 'demo' for item in results) else 'live_current'}
