"""Offline scientific-screening and provider resilience tests for version 4.0."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app import agronomy_v4, ai_assistant, main


def rust_points(rain: float = 0.4, humidity: float = 95, temp: float = 20):
    return [
        {"temperature_c": temp, "humidity_pct": humidity, "rain_mm_3h": rain},
        {"temperature_c": temp, "humidity_pct": humidity, "rain_mm_3h": rain},
    ]


def water_payload(precip=2.0, et0=3.0):
    now = datetime.now(timezone.utc).date()
    dates = [(now - timedelta(days=i)).isoformat() for i in range(7, 0, -1)]
    return {"daily": {
        "time": dates + [now.isoformat()],
        "precipitation_sum": [precip] * 7 + [100.0],
        "et0_fao_evapotranspiration": [et0] * 7 + [100.0],
    }}


def test_wheat_leaf_rust_references_and_two_moist_intervals():
    result = agronomy_v4.wheat_rust_screen(
        {"crop": "Пшеница озимая"},
        {"source": "openweather_forecast_3h", "points": rust_points()},
    )
    assert result["status"] == "watch"
    assert result["matched_intervals"] == 2
    assert "не диагноз" in " ".join(result["limitations"]).lower() or "диагноз" in " ".join(result["limitations"])
    assert all(s["url"].startswith("https://") for s in result["sources"])
    assert "15–25" in result["explanation"]


def test_wheat_disease_not_diagnosed_when_rain_missing_or_wetness_unmeasured():
    missing = agronomy_v4.wheat_rust_screen(
        {"crop": "wheat"}, {"source": "unavailable", "points": []})
    assert missing["status"] == "unknown"
    dry = agronomy_v4.wheat_rust_screen(
        {"crop": "Пшеница"}, {"source": "openweather_forecast_3h",
                             "points": rust_points(rain=0)})
    assert dry["status"] == "no_signal"
    assert "не подтверждает отсутствие" in dry["explanation"]
    unknown = agronomy_v4.wheat_rust_screen(
        {"crop": "Пшеница"}, {"source": "openweather_forecast_3h",
                             "points": [{"temperature_c": 20, "humidity_pct": None, "rain_mm_3h": 2}]})
    assert unknown["status"] == "unknown"


def test_other_crop_no_wheat_disease_signal():
    result = agronomy_v4.wheat_rust_screen(
        {"crop": "Кукуруза"}, {"source": "openweather_forecast_3h", "points": rust_points()})
    assert result["status"] == "not_applicable"
    assert result["matched_intervals"] == 0


def test_seven_complete_days_p_minus_et0_not_soil_water():
    result = agronomy_v4.water_balance_7d(water_payload())
    assert result["status"] == "available"
    assert result["days"] == 7
    assert result["precipitation_7d_mm"] == 14
    assert result["et0_7d_mm"] == 21
    assert result["p_minus_et0_mm"] == -7
    assert "не запасы воды в почве" in result["limitation"]
    assert "P − ET₀" in result["limitation"]


def test_missing_water_days_are_not_imputed_as_dry_weather():
    payload = water_payload()
    payload["daily"]["precipitation_sum"][3] = None
    result = agronomy_v4.water_balance_7d(payload)
    assert result["status"] == "partial"
    assert result["precipitation_7d_mm"] is None
    assert result["days"] == 6
    disabled = agronomy_v4.water_balance_7d({"status": "disabled"})
    assert disabled["status"] == "disabled"


@pytest.mark.asyncio
async def test_openmeteo_is_optional_cached_and_no_api_secret(monkeypatch):
    monkeypatch.setenv("AGRORADAR_WATER_CONTEXT", "1")
    agronomy_v4._WATER_CACHE.clear()
    call_count = 0
    async def fake_get(self, url, **kwargs):
        nonlocal call_count
        call_count += 1
        assert "api.open-meteo.com" in url
        assert "appid" not in kwargs["params"]
        assert kwargs["params"]["past_days"] == 8
        return httpx.Response(200, request=httpx.Request("GET",url), json=water_payload())
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)
    field={"id": 1, "name": "Тест", "crop": "Пшеница", "lat": 50.612, "lon":36.578}
    first=await agronomy_v4.fetch_water_history(field)
    again=await agronomy_v4.fetch_water_history(field)
    assert first==again
    assert call_count==1
    analysis=await agronomy_v4.build_agronomy(field, {"source":"demo","points":rust_points()})
    assert analysis["water_context"]["status"]=="available"
    assert analysis["phytosanitary"]["status"]=="watch"
    monkeypatch.setenv("AGRORADAR_WATER_CONTEXT","0")
    assert (await agronomy_v4.fetch_water_history(field))["status"]=="disabled"


@pytest.mark.asyncio
async def test_deepseek_models_probe_distinguishes_key_from_real_access(monkeypatch):
    ai_assistant._AVAILABILITY_CACHE.clear()
    calls=[]
    async def fake_get(self, url, **kwargs):
        calls.append(url)
        assert url=="https://api.deepseek.com/models"
        assert kwargs["headers"]["Authorization"]=="Bearer KEY_NOT_EXPOSE"
        return httpx.Response(200, request=httpx.Request("GET",url),
                              json={"data":[{"id":"deepseek-flash"}]})
    monkeypatch.setattr(httpx.AsyncClient,"get",fake_get)
    first=await ai_assistant.provider_availability("KEY_NOT_EXPOSE","deepseek-flash")
    second=await ai_assistant.provider_availability("KEY_NOT_EXPOSE","deepseek-flash")
    assert first==second
    assert first["availability"]=="online"
    assert len(calls)==1
    assert "KEY_NOT_EXPOSE" not in str(first)
    assert (await ai_assistant.provider_availability("","deepseek-flash"))["availability"]=="not_configured"


@pytest.mark.asyncio
async def test_deepseek_probe_invalid_and_timeout(monkeypatch):
    ai_assistant._AVAILABILITY_CACHE.clear()
    async def invalid(self,url,**kwargs):
        return httpx.Response(401,request=httpx.Request("GET",url),json={"message":"token-is-secret"})
    monkeypatch.setattr(httpx.AsyncClient,"get",invalid)
    result=await ai_assistant.provider_availability("BAD_KEY","deepseek-flash")
    assert result["availability"]=="invalid_key"
    assert "token-is-secret" not in str(result)
    async def timeout(self,url,**kwargs):
        raise httpx.ConnectTimeout("network down",request=httpx.Request("GET",url))
    monkeypatch.setattr(httpx.AsyncClient,"get",timeout)
    result=await ai_assistant.provider_availability("ANOTHER_KEY","deepseek-flash")
    assert result["availability"]=="unavailable"


def test_selected_field_agronomy_endpoint_does_not_modify_catalog(monkeypatch,tmp_path):
    monkeypatch.setattr(main,"CATALOG_FILE",tmp_path/"fields.json")
    monkeypatch.setattr(main,"GEOMETRY_FILE",tmp_path/"geometries.json")
    monkeypatch.setenv("AGRORADAR_WATER_CONTEXT","0")
    monkeypatch.delenv("OPENWEATHER_API_KEY",raising=False)
    client=TestClient(main.app)
    res=client.get("/api/fields/1/agronomy")
    assert res.status_code==200, res.text
    body=res.json()
    assert body["version"]=="4.0"
    assert body["forecast_source"]=="demo"
    assert body["phytosanitary"]["status"] in ("watch","no_signal","partial","unknown")
    assert body["water_context"]["status"]=="disabled"
    assert not (tmp_path/"fields.json").exists()
