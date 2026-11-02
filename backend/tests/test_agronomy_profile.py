"""AgroRadar v2.1: profile migration, observations and AI context (offline)."""
import json
from fastapi.testclient import TestClient
from app import main, ai_assistant


def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(main, 'CATALOG_FILE', tmp_path / 'fields.json')
    monkeypatch.setattr(main, 'GEOMETRY_FILE', tmp_path / 'geometry.json')
    monkeypatch.delenv('OPENWEATHER_API_KEY', raising=False)
    main._CACHE.clear()
    return TestClient(main.app)


def test_migrated_fields_have_empty_profile_and_do_not_lose_data(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    first = client.get('/api/fields/1').json()
    assert first['soil_type'] == ''
    assert first['growth_stage'] == ''
    assert first['sowing_date'] == ''
    assert first['observations'] == []
    response = client.put('/api/fields/1', json={
        'name': 'Поле Северное', 'crop': 'Пшеница', 'description': 'Осмотр',
        'sowing_date': '2026-10-05', 'growth_stage': 'Всходы', 'soil_type': 'Чернозём',
    })
    assert response.status_code == 200, response.text
    current = client.get('/api/fields/1').json()
    assert current['growth_stage'] == 'Всходы'
    # Legacy client edits don't destroy profile.
    assert client.put('/api/fields/1', json={'name':'Поле Северное 2','crop':'Пшеница','description':'Новая карточка'}).status_code == 200
    again = TestClient(main.app).get('/api/fields/1').json()
    assert again['sowing_date'] == '2026-10-05'
    assert again['soil_type'] == 'Чернозём'
    assert again['name'] == 'Поле Северное 2'


def test_new_field_profile_and_validation(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    payload = {'name': 'Поле Ромашка', 'crop': 'Рапс', 'description': 'Посев',
        'sowing_date': '2026-04-10', 'growth_stage':'Розетка', 'soil_type':'Суглинок',
        'coordinates': [[36.71, 50.70], [36.72,50.70], [36.72, 50.71], [36.71,50.71]]}
    response = client.post('/api/fields', json=payload)
    assert response.status_code == 201, response.text
    field_id = response.json()['field']['id']
    result = client.get(f'/api/fields/{field_id}').json()
    assert result['growth_stage'] == 'Розетка'
    assert result['soil_type'] == 'Суглинок'
    for invalid in ['2026-02-30', '03.04.2026', '2000-00-02']:
        request = client.put(f'/api/fields/{field_id}', json={
            'name':'Поле Ромашка','crop':'Рапс','sowing_date':invalid})
        assert request.status_code == 422, request.text
    assert client.get(f'/api/fields/{field_id}').json()['sowing_date'] == '2026-04-10'
    assert client.put(f'/api/fields/{field_id}', json={
        'name':'Поле Ромашка','crop':'Рапс','sowing_date':''}).status_code == 200
    assert client.get(f'/api/fields/{field_id}').json()['sowing_date'] == ''


def test_observations_persist_delete_and_validate(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    response = client.post('/api/fields/2/observations',json={
        'text':'Визуально заметны неоднородные всходы.', 'observed_on':'2026-10-21'})
    assert response.status_code == 201, response.text
    note = response.json()['observation']
    assert note['source'] == 'manual'
    records = client.get('/api/fields/2/observations').json()['observations']
    assert len(records) == 1 and records[0]['id'] == note['id']
    assert TestClient(main.app).get('/api/fields/2').json()['observations'][0]['text'] == 'Визуально заметны неоднородные всходы.'
    assert client.post('/api/fields/2/observations',json={'text':' '} ).status_code == 422
    assert client.post('/api/fields/2/observations',json={'text':'x'*1001}).status_code == 422
    assert client.post('/api/fields/2/observations',json={'text':'Наблюдение', 'observed_on':'2026-02-30'}).status_code == 422
    assert client.post('/api/fields/999/observations',json={'text':'Видно поле'}).status_code == 404
    assert client.delete(f"/api/fields/2/observations/{note['id']}").status_code == 200
    assert client.get('/api/fields/2/observations').json()['observations'] == []
    assert client.delete(f"/api/fields/2/observations/{note['id']}").status_code == 404


def test_ai_context_includes_user_entered_profile_and_manual_notes(monkeypatch, tmp_path):
    client = setup(monkeypatch, tmp_path)
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'TEST_NOT_REAL')
    client.put('/api/fields/1', json={'name':'Поле Северное','crop':'Пшеница',
        'growth_stage':'Кущение','soil_type':'Чернозём','sowing_date':'2026-09-12'})
    client.post('/api/fields/1/observations',json={'text':'На листьях пятна, нужен осмотр', 'observed_on':'2026-10-20'})
    sent = []
    async def fake_request(messages, api_key, model):
        sent.extend(messages)
        return {'answer':'Проверьте поле и обратитесь к агроному', 'model':model, 'usage':{'total_tokens':30}}
    monkeypatch.setattr(ai_assistant, 'request_deepseek', fake_request)
    response = client.post('/api/ai/chat',json={'field_id':1,'message':'Что проверить?'})
    assert response.status_code == 200, response.text
    context = json.loads(sent[1]['content'].split('\n', 1)[1])
    assert context['field']['soil_type_unverified'] == 'Чернозём'
    assert context['field']['growth_stage_unverified'] == 'Кущение'
    assert context['field']['sowing_date'] == '2026-09-12'
    assert context['field']['manual_observations_unverified'][0]['observed_on'] == '2026-10-20'
    assert len(client.get('/api/dashboard').json()['fields'][0]['risk_analysis']['assessments']) == 4
