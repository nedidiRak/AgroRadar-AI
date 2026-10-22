from fastapi.testclient import TestClient
from app import main


def test_draw_save_export_reset(monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'field_geometries.json')
    client = TestClient(main.app)
    before = client.get('/api/fields.geojson')
    assert before.status_code == 200
    demo = before.json()['features'][0]
    assert demo['properties']['geometry_source'] == 'demo_generated'

    ring = [[36.571,50.608],[36.584,50.608],[36.587,50.616],[36.571,50.616]]
    saved = client.put('/api/fields/1/geometry', json={'coordinates':ring})
    assert saved.status_code == 200, saved.text
    assert (tmp_path / 'field_geometries.json').exists()
    exported = client.get('/api/fields.geojson').json()['features'][0]
    assert exported['properties']['geometry_source']=='user_drawn'
    assert exported['geometry']['coordinates'][0][0] == ring[0]
    assert len(exported['geometry']['coordinates'][0]) == 5
    field = client.get('/api/fields/1').json()
    assert field['geometry_source']=='user_drawn'
    assert 50 < field['area_ha'] < 150
    dashboard = client.get('/api/dashboard').json()
    assert dashboard['count'] == 4
    assert dashboard['fields'][0]['geometry_source'] == 'user_drawn'
    assert client.delete('/api/fields/1/geometry').status_code == 200
    assert client.get('/api/fields.geojson').json()['features'][0]['properties']['geometry_source']=='demo_generated'


def test_invalid_polygons_rejected(monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'field_geometries.json')
    client = TestClient(main.app)
    for ring in ([], [[1,2],[3,4]], [[37,51],[37,51],[37,51]],
                 [[36.57,50.60],[36.60,50.63],[36.57,50.63],[36.60,50.60]]):
        response = client.put('/api/fields/1/geometry',json={'coordinates':ring})
        assert response.status_code == 422, (ring,response.text)
    assert client.get('/api/health').json()['version']=='0.8.0'
