"""Offline regression tests: no network calls and no real API keys."""
import time

from fastapi.testclient import TestClient
from app import main


def test_demo_conditions_are_clearly_marked(monkeypatch, tmp_path):
    monkeypatch.delenv('OPENWEATHER_API_KEY', raising=False)
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'geometry.json')
    monkeypatch.setattr(main, 'CATALOG_FILE', tmp_path / 'fields.json')
    main._CACHE.clear()
    client = TestClient(main.app)
    assert client.get('/api/health').json()['weather_mode'] == 'demo'
    result = client.get('/api/dashboard')
    assert result.status_code == 200
    field = result.json()['fields'][0]
    assert field['weather']['source'] == 'demo'
    assert field['forecast']['source'] == 'demo'
    assert len(field['forecast']['points']) == 8
    assert field['forecast']['points'][0]['precipitation_probability_pct'] is None


def test_openweather_forecast_points_and_risk(monkeypatch, tmp_path):
    monkeypatch.setenv('OPENWEATHER_API_KEY', 'FAKE_TEST_TOKEN')
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'geometry.json')
    monkeypatch.setattr(main, 'CATALOG_FILE', tmp_path / 'fields.json')
    main._CACHE.clear()
    now = int(time.time())

    async def fake_request(endpoint, field, key):
        assert key == 'FAKE_TEST_TOKEN'
        if endpoint == 'weather':
            return {'main': {'temp': 11.2, 'humidity': 68},
                    'wind': {'speed': 4.4}, 'dt': now}
        if endpoint == 'forecast':
            return {'list': [
                {'dt': now + 3600, 'main': {'temp': 4, 'temp_min': 2}, 'pop': 0.2},
                {'dt': now + 4 * 3600, 'main': {'temp': -1, 'temp_min': -2}, 'pop': 0.8,
                 'rain': {'3h': 1.25}},
                {'dt': now + 27 * 3600, 'main': {'temp': -9, 'temp_min': -10}, 'pop': 1.0},
            ]}
        raise AssertionError(endpoint)

    monkeypatch.setattr(main, '_openweather_request', fake_request)
    client = TestClient(main.app)
    assert client.get('/api/health').json()['weather_mode'] == 'live'
    result = client.get('/api/fields/1/risks')
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['risk']['level'] == 'high'
    assert data['forecast']['min_temperature_next_24h_c'] == -2
    assert data['forecast']['sample_count'] == 2
    assert [x['precipitation_probability_pct'] for x in data['forecast']['points']] == [20, 80]
    assert data['forecast']['points'][1]['rain_mm_3h'] == 1.25
    assert data['weather']['source'] == 'openweather_current'
