"""Regressions: one OpenWeather failure cannot hide healthy fields or invent weather."""
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import main, ai_assistant


def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'CATALOG_FILE', tmp_path / 'fields.json')
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'geometries.json')
    monkeypatch.setenv('OPENWEATHER_API_KEY', 'DUMMY_NOT_REAL')
    main._CACHE.clear()
    return TestClient(main.app)


def test_one_provider_failure_preserves_all_fields_without_fake_weather(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)

    async def partial(field):
        if field['id'] == 2:
            raise HTTPException(503, 'OpenWeather timeout for field 2')
        return main._demo_data(field)

    monkeypatch.setattr(main, 'field_conditions', partial)
    response = client.get('/api/dashboard')
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['count'] == 4
    assert data['degraded_count'] == 1
    assert data['degraded_field_ids'] == [2]
    assert len(data['fields']) == 4
    missing = next(f for f in data['fields'] if f['id'] == 2)
    healthy = next(f for f in data['fields'] if f['id'] == 1)
    assert missing['weather']['source'] == 'unavailable'
    assert missing['weather']['temperature_c'] is None
    assert missing['weather']['humidity_pct'] is None
    assert missing['forecast']['min_temperature_next_24h_c'] is None
    assert missing['risk']['level'] == 'unknown'
    assert missing['risk_analysis']['known_count'] == 0
    assert missing['risk_analysis']['coverage_complete'] is False
    assert 'timeout' in missing['weather_error']
    assert healthy['weather']['source'] == 'demo'
    assert client.get('/api/fields.geojson').status_code == 200


def test_single_field_risk_endpoint_gracefully_degrades(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    async def down(field):
        raise HTTPException(503, 'Provider unavailable')
    monkeypatch.setattr(main, 'field_conditions', down)
    response = client.get('/api/fields/1/risks')
    assert response.status_code == 200
    payload = response.json()
    assert payload['weather']['source'] == 'unavailable'
    assert payload['risk']['level'] == 'unknown'
    assert all(row['level'] == 'unknown' for row in payload['risk_analysis']['assessments'])


def test_ai_context_contains_explicit_unavailable_weather(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'DUMMY')
    ai_assistant._CALLS_BY_CLIENT.clear()
    async def down(field):
        raise HTTPException(503, 'Provider temporarily down')
    monkeypatch.setattr(main, 'field_conditions', down)
    captured = []

    async def fake_deepseek(messages, api_key, model):
        captured.extend(messages)
        return {'answer': 'Погодные данные отсутствуют.', 'model': model, 'usage': {}}

    monkeypatch.setattr(ai_assistant, 'request_deepseek', fake_deepseek)
    response = client.post('/api/ai/chat', json={'field_id': 1, 'message': 'Какая погода?'})
    assert response.status_code == 200, response.text
    assert response.json()['weather_source'] == 'unavailable'
    assert '"source":"unavailable"' in captured[1]['content']
    assert '"temperature_c":null' in captured[1]['content']


def test_unexpected_programming_errors_are_not_silenced(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    async def broken(field):
        raise HTTPException(422, 'Internal validation error')
    monkeypatch.setattr(main, 'field_conditions', broken)
    response = client.get('/api/dashboard')
    assert response.status_code == 422
