"""Offline, deterministic regression tests for risk rules and scenario isolation."""
from fastapi.testclient import TestClient
from app import main
from app.risk_engine import analyze_risks, simulate_scenario


def example(points, minimum):
    return analyze_risks({}, {'source': 'openweather_forecast_3h',
         'points': points, 'min_temperature_next_24h_c': minimum, 'period_hours': 24})


def point(temp=12, rain=0, speed=3, gust=4, humidity=65):
    return {'temperature_c': temp, 'rain_mm_3h': rain, 'wind_ms': speed,
            'wind_gust_ms': gust, 'humidity_pct': humidity}


def by_id(result):
    return {r['id']: r for r in result['assessments']}


def test_no_risk_for_normal_conditions():
    result = example([point()] * 8, 7)
    assert result['overall']['level'] == 'low'
    assert result['known_count'] == 4
    assert all(r['level'] == 'low' for r in result['assessments'])


def test_frost_threshold_edges():
    for minimum, expected in [(-1, 'high'), (0, 'high'), (0.1, 'medium'), (3, 'medium'), (3.1, 'low')]:
        assert by_id(example([point()], minimum))['frost']['level'] == expected


def test_rain_sum_and_probability_not_aggregated():
    forecast = example([dict(point(rain=3.9), precipitation_probability_pct=100)] * 8, 7)
    assert by_id(forecast)['rain']['value'] == 31.2
    assert by_id(forecast)['rain']['level'] == 'high'
    forecast = example([point(rain=1.9)] * 8, 7)
    assert by_id(forecast)['rain']['level'] == 'medium'


def test_wind_gust_and_speed_fallback():
    assert by_id(example([point(gust=20)], 7))['wind']['level'] == 'high'
    assert by_id(example([point(gust=None, speed=10)], 7))['wind']['level'] == 'medium'
    assert by_id(example([point(gust=None, speed=15)], 7))['wind']['level'] == 'high'


def test_dry_heat_is_not_drought_diagnosis():
    result = by_id(example([point(temp=35, rain=0, humidity=22)], 12))['dry_heat']
    assert result['level'] == 'high'
    assert 'НЕ диагноз засухи' in result['reason']
    assert by_id(example([point(temp=35, rain=5, humidity=22)], 12))['dry_heat']['level'] == 'low'


def test_missing_data_is_not_treated_as_safe():
    result = example([point(temp=7, rain=None, speed=None, gust=None, humidity=None)], 4)
    risks = by_id(result)
    assert risks['rain']['level'] == 'unknown'
    assert risks['wind']['level'] == 'unknown'
    assert risks['dry_heat']['level'] == 'unknown'
    assert result['unknown_count'] == 3


def test_scenarios_are_explicit_simulations_and_independent():
    scenarios = {'frost': 'frost', 'rain': 'rain', 'wind': 'wind', 'dry_heat': 'dry_heat'}
    for name, risk_id in scenarios.items():
        response = simulate_scenario(name)
        assert response['analysis']['source'] == 'scenario'
        assert response['analysis']['is_simulation'] is True
        assert by_id(response['analysis'])[risk_id]['level'] == 'high'
    assert 'СИМУЛЯЦИЯ' in simulate_scenario('frost')['notice']


def test_http_scenarios_do_not_modify_field_catalog(monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'CATALOG_FILE', tmp_path / 'fields.json')
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'geometries.json')
    monkeypatch.delenv('OPENWEATHER_API_KEY', raising=False)
    client = TestClient(main.app)
    before = client.get('/api/fields').json()
    response = client.get('/api/risks/scenarios/frost')
    assert response.status_code == 200
    assert client.get('/api/risks/scenarios/missing').status_code == 404
    assert client.get('/api/fields').json() == before
    assert client.get('/api/dashboard').json()['fields'][0]['risk_analysis']['is_simulation'] is True


def test_dashboard_uses_overall_risk_and_legacy_temperature(monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'CATALOG_FILE', tmp_path / 'fields.json')
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'geometries.json')
    monkeypatch.delenv('OPENWEATHER_API_KEY', raising=False)
    client = TestClient(main.app)
    dashboard = client.get('/api/dashboard')
    assert dashboard.status_code == 200
    field = dashboard.json()['fields'][0]
    assert 'risk_analysis' in field
    assert len(field['risk_analysis']['assessments']) == 4
    assert field['risk']['level'] == field['temperature_risk']['level']


def test_dry_heat_uses_same_three_hour_window():
    result = example([point(temp=35, humidity=70), point(temp=20, humidity=20)], 12)
    assert by_id(result)['dry_heat']['level'] == 'low'


def test_live_rain_can_raise_overall_risk_without_frost(monkeypatch, tmp_path):
    import time
    monkeypatch.setattr(main, 'CATALOG_FILE', tmp_path / 'fields.json')
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'geometries.json')
    monkeypatch.setenv('OPENWEATHER_API_KEY', 'OFFLINE_FAKE')
    now = int(time.time())

    async def fake_request(endpoint, field, key):
        if endpoint == 'weather':
            return {'main': {'temp': 22, 'humidity': 75}, 'wind': {'speed': 4}, 'dt': now}
        return {'list': [
            {'dt': now + i * 10800 + 300, 'main': {'temp': 19, 'temp_min': 17, 'humidity': 85},
             'wind': {'speed': 4, 'gust': 5}, 'rain': {'3h': 5}, 'pop': 0.95}
            for i in range(7)]}

    monkeypatch.setattr(main, '_openweather_request', fake_request)
    result = TestClient(main.app).get('/api/fields/1/risks')
    assert result.status_code == 200, result.text
    data = result.json()
    assert data['temperature_risk']['level'] == 'low'
    assert data['risk']['level'] == 'high'
    assert by_id(data['risk_analysis'])['rain']['value'] == 35
