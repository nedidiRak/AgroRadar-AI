"""Regression tests for OpenWeather transport errors and cache isolation. No live network."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app import main

FIELD = {'id': 9, 'name': 'Тестовое поле', 'lat': 50.612, 'lon': 36.578}


def _mock_client(monkeypatch, handler):
    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(main.httpx, 'AsyncClient', lambda *a, **kw: original_client(transport=transport))


def test_weather_retries_throttling_then_caches(monkeypatch):
    main._CACHE.clear()
    calls = []
    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            return httpx.Response(429, json={'message':'Too many requests'})
        return httpx.Response(200, json={'main': {'temp': 12.0}})
    _mock_client(monkeypatch, handler)
    result = asyncio.run(main._openweather_request('weather', FIELD, 'fake-key-a'))
    again = asyncio.run(main._openweather_request('weather', FIELD, 'fake-key-a'))
    assert result == again
    assert len(calls) == 2
    assert all('fake-key-a' in str(req.url) for req in calls)


def test_weather_bad_token_not_retried(monkeypatch):
    main._CACHE.clear()
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(401, json={'message':'Invalid API key'})
    _mock_client(monkeypatch, handler)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(main._openweather_request('weather', FIELD, 'fake-key-b'))
    assert len(calls) == 1


def test_weather_cache_is_scoped_by_token(monkeypatch):
    main._CACHE.clear()
    calls = []
    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, json={'main': {'temp': len(calls)}})
    _mock_client(monkeypatch, handler)
    asyncio.run(main._openweather_request('weather', FIELD, 'fake-key-c'))
    asyncio.run(main._openweather_request('weather', FIELD, 'fake-key-d'))
    assert len(calls) == 2


def test_field_conditions_explain_provider_401_without_leaking_key(monkeypatch):
    monkeypatch.setenv('OPENWEATHER_API_KEY', 'SECRET_NEVER_SHOW')
    async def fake_request(endpoint, field, key):
        request = httpx.Request('GET', 'https://api.openweathermap.org/data/2.5/' + endpoint)
        response = httpx.Response(401, request=request)
        raise httpx.HTTPStatusError('unauthorized', request=request, response=response)
    monkeypatch.setattr(main, '_openweather_request', fake_request)
    client = TestClient(main.app)
    response = client.get('/api/fields/1/weather')
    assert response.status_code == 503
    message = response.json()['detail']
    assert 'HTTP 401' in message
    assert 'Северное' in message
    assert 'SECRET_NEVER_SHOW' not in message
