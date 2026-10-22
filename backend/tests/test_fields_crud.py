"""Regression for new field CRUD and migration from v0.9 without live API calls."""
import json
from fastapi.testclient import TestClient
from app import main

RING = [[36.701, 50.701], [36.716, 50.701], [36.716, 50.71], [36.701, 50.71]]
OTHER = [[36.755, 50.75], [36.763, 50.75], [36.763, 50.76], [36.755, 50.76]]


def setup(monkeypatch, tmp_path):
    monkeypatch.delenv('OPENWEATHER_API_KEY', raising=False)
    monkeypatch.setattr(main, 'CATALOG_FILE', tmp_path / 'fields.json')
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'field_geometries.json')
    return TestClient(main.app)


def test_creates_fifth_field_at_own_coordinates_edit_and_delete(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    assert client.get('/api/dashboard').json()['count'] == 4
    payload = {'name': 'Поле Лесное', 'crop': 'Ячмень',
               'description': 'Посев 2026. Супесчаная почва.', 'coordinates': RING}
    resp = client.post('/api/fields', json=payload)
    assert resp.status_code == 201, resp.text
    fid = resp.json()['field']['id']
    assert fid == 5
    assert resp.json()['field']['geometry_source'] == 'user_drawn'
    assert resp.json()['field']['lat'] > 50.70
    assert resp.json()['field']['lon'] > 36.70
    assert (tmp_path / 'fields.json').exists()
    assert client.get('/api/dashboard').json()['count'] == 5
    features = client.get('/api/fields.geojson').json()['features']
    own = next(f for f in features if f['properties']['field_id'] == fid)
    assert own['geometry']['coordinates'][0][:4] == RING
    assert own['properties']['crop'] == 'Ячмень'
    assert own['properties']['description'].startswith('Посев')

    edit = client.put('/api/fields/5', json={
        'name': 'Поле Лесное 2', 'crop': 'Рапс', 'description': 'Новый посев',
    })
    assert edit.status_code == 200, edit.text
    assert client.get('/api/fields/5').json()['crop'] == 'Рапс'
    assert client.get('/api/fields/5').json()['description'] == 'Новый посев'

    moved = client.put('/api/fields/5/geometry', json={'coordinates': OTHER})
    assert moved.status_code == 200, moved.text
    assert client.get('/api/fields/5').json()['lat'] > 50.75
    assert client.delete('/api/fields/5/geometry').status_code == 409
    assert client.delete('/api/fields/5').json()['deleted'] is True
    assert client.get('/api/dashboard').json()['count'] == 4
    assert client.get('/api/fields/5').status_code == 404
    assert len(client.get('/api/fields.geojson').json()['features']) == 4
    created_again = client.post('/api/fields', json={**payload, 'coordinates': OTHER})
    assert created_again.status_code == 201
    assert created_again.json()['field']['id'] == 6  # never reuse ID of deleted fields


def test_legacy_geometry_and_demo_edit_survive_catalog_creation(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    old_ring = [[36.501, 50.601], [36.51, 50.601], [36.51, 50.61], [36.501, 50.61], [36.501, 50.601]]
    (tmp_path / 'field_geometries.json').write_text(
        json.dumps({'2': {'coordinates': old_ring, 'source': 'user_drawn'}}), encoding='utf-8')
    before = client.get('/api/fields/2').json()
    assert before['geometry_source'] == 'user_drawn'
    edited = client.put('/api/fields/2', json={'name': 'Поле Восточное – тест',
                                            'crop': 'Озимая пшеница', 'description': 'Влага'})
    assert edited.status_code == 200
    after = client.get('/api/fields/2').json()
    assert after['geometry_source'] == 'user_drawn'
    assert after['crop'] == 'Озимая пшеница'
    assert after['description'] == 'Влага'
    assert after['lat'] == before['lat']
    assert client.delete('/api/fields/2/geometry').status_code == 200
    assert client.get('/api/fields/2').json()['geometry_source'] == 'demo_generated'
    assert client.get('/api/fields/2').json()['lat'] == 50.635
    assert client.get('/api/fields/2').json()['name'] == 'Поле Восточное – тест'
    assert client.delete('/api/fields/2').status_code == 200
    assert client.get('/api/dashboard').json()['count'] == 3
    # Re-instantiate client; a deleted default is never recreated.
    assert TestClient(main.app).get('/api/dashboard').json()['count'] == 3


def test_validation_and_empty_catalog(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    for bad in [
        {'name': '', 'crop': 'Соя', 'description': '', 'coordinates': RING},
        {'name': 'Пятое', 'crop': '', 'description': '', 'coordinates': RING},
        {'name': 'Пятое', 'crop': 'Соя', 'description': '', 'coordinates': []},
    ]:
        assert client.post('/api/fields', json=bad).status_code == 422
    assert client.put('/api/fields/999', json={'name':'x','crop':'y','description':''}).status_code == 404
    assert client.delete('/api/fields/999').status_code == 404
    assert client.post('/api/fields', json={'name':'поле северное','crop':'соя','coordinates': RING}).status_code == 409
    for i in range(1,5):
        assert client.delete(f'/api/fields/{i}').status_code == 200
    assert client.get('/api/dashboard').json()['count'] == 0
    assert client.get('/api/fields.geojson').json()['features'] == []
    assert client.post('/api/fields', json={'name':'Поле новое','crop':'Гречиха','coordinates': RING}).json()['field']['id'] == 5
