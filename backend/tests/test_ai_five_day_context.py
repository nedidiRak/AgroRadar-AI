"""Five-day DeepSeek context is real, bounded, and does not fabricate missing weather."""
import json
import time

from fastapi.testclient import TestClient

from app import main, ai_assistant
from app.ai_forecast_context import prepare_five_day_context
from app.five_day import build_five_day_forecast


def make_points(now):
    return [{
        "timestamp": now + 3600 + i * 10800,
        "temperature_c": -3.0 if i // 8 == 1 else 19.0,
        "minimum_temperature_c": -4.0 if i // 8 == 1 else 18.0,
        "humidity_pct": 65,
        "rain_mm_3h": 4.0 if i // 8 == 2 else 0.0,
        "precipitation_probability_pct": 80 if i // 8 == 2 else 0,
        "wind_ms": 4.0,
        "wind_gust_ms": 6.0,
    } for i in range(40)]


def test_daily_summary_uses_all_five_independent_24h_screenings():
    now = 1800000000
    raw = build_five_day_forecast(make_points(now), "openweather_forecast_3h",
                                   {"crop": "Пшеница"}, issued_at=now)
    result = prepare_five_day_context(raw, "Какие угрозы на пять дней?")
    assert result["source"] == "openweather_forecast_3h"
    assert result["has_forecast_data"] is True
    assert len(result["days"]) == 5
    assert [d["forecast_points"] for d in result["days"]] == [8] * 5
    assert result["days"][1]["min_temperature_c"] == -4
    assert result["days"][1]["weather_risk"]["level"] == "high"
    assert result["days"][2]["precipitation_mm"] == 32
    assert result["days"][2]["weather_risk"]["level"] == "high"
    assert result["days"][0]["precipitation_mm"] == 0
    assert result["days"][0]["weather_risk"]["level"] == "low"
    assert all("forecast_intervals_3h" not in d for d in result["days"])
    assert "rolling 24h" in result["windows"]
    assert result["days"][0]["crop_research_preview"]["approved_rules"] == 0


def test_hourly_detail_is_available_only_for_time_sensitive_questions():
    raw = build_five_day_forecast(make_points(1800000000), "openweather_forecast_3h",
                                  issued_at=1800000000)
    result = prepare_five_day_context(raw, "Когда завтра ветер и мороз по часам?")
    assert len(result["days"]) == 5
    assert len(result["days"][1]["forecast_intervals_3h"]) == 8
    assert result["days"][1]["forecast_intervals_3h"][0]["at_utc"].endswith("+00:00")
    assert result["days"][1]["forecast_intervals_3h"][0]["temperature_c"] == -3
    assert "forecast_intervals_3h" not in prepare_five_day_context(raw, "Что угрожает полю?")["days"][0]
    # Do not let provider input accidentally blow up the LLM token budget.
    raw["days"].append(raw["days"][0])
    raw["days"][0]["points"] = raw["days"][0]["points"] * 25
    bounded = prepare_five_day_context(raw, "во сколько?")["days"]
    assert len(bounded) == 5
    assert len(bounded[0]["forecast_intervals_3h"]) == 8


def test_missing_five_day_data_is_unknown_never_safe():
    raw = build_five_day_forecast(make_points(1800000000)[:3], "openweather_forecast_3h",
                                  issued_at=1800000000)
    result = prepare_five_day_context(raw, "Дай прогноз на неделю")
    assert len(result["days"]) == 5
    assert result["days"][0]["forecast_points"] == 3
    for day in result["days"][1:]:
        assert day["forecast_points"] == 0
        assert day["weather_risk"]["level"] == "unknown"
        assert day["precipitation_mm"] is None
        assert day["data_quality"]["status"] == "unavailable"
    unavailable = prepare_five_day_context(None, "Что дальше?")
    assert unavailable["has_forecast_data"] is False
    assert unavailable["source"] == "unavailable"
    assert unavailable["days"] == []


def test_chat_sends_real_multiday_context_without_new_provider_calls(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "field_geometries.json")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "FAKE_SECRET_NOT_FOR_LLM")
    monkeypatch.setenv("OPENWEATHER_API_KEY", "FAKE_OPENWEATHER_KEY")
    monkeypatch.delenv("AGRORADAR_EXPERT_PORTABLE", raising=False)
    ai_assistant._CALLS_BY_CLIENT.clear()
    main._CACHE.clear()
    now = int(time.time())
    points = make_points(now)
    calls = []

    async def provider(endpoint, field, key):
        calls.append(endpoint)
        assert key == "FAKE_OPENWEATHER_KEY"
        if endpoint == "weather":
            return {"main": {"temp": 12.1, "humidity": 56},
                    "wind": {"speed": 2.4}, "dt": now}
        return {"list": [{
            "dt": row["timestamp"],
            "main": {"temp": row["temperature_c"],
                     "temp_min": row["minimum_temperature_c"],
                     "humidity": row["humidity_pct"]},
            "wind": {"speed": row["wind_ms"], "gust": row["wind_gust_ms"]},
            "rain": {"3h": row["rain_mm_3h"]},
            "pop": row["precipitation_probability_pct"] / 100,
        } for row in points]}

    captured = []

    async def fake_deepseek(messages, api_key, model):
        captured.extend(messages)
        assert api_key == "FAKE_SECRET_NOT_FOR_LLM"
        return {"answer": "Проверьте риски по дням.", "model": model, "usage": {}}

    monkeypatch.setattr(main, "_openweather_request", provider)
    monkeypatch.setattr(ai_assistant, "request_deepseek", fake_deepseek)
    client = TestClient(main.app)
    resp = client.post("/api/ai/chat", json={
        "field_id": 1, "message": "Какие угрозы в ближайшие пять суток?"
    })
    assert resp.status_code == 200, resp.text
    assert sorted(calls) == ["forecast", "weather"], "Do not fetch again for 5-day context"
    context = json.loads(captured[1]["content"].split("\n", 1)[1])
    assert len(context["forecast_5day"]["days"]) == 5
    assert context["forecast_24h"]["sample_count"] <= 8
    assert context["forecast_5day"]["days"][1]["weather_risk"]["level"] == "high"
    assert context["forecast_5day"]["days"][2]["precipitation_mm"] == 32
    assert context["forecast_5day"]["days"][4]["forecast_points"] == 8
    assert "forecast_intervals_3h" not in context["forecast_5day"]["days"][0]
    assert "FAKE_SECRET_NOT_FOR_LLM" not in captured[1]["content"]
    assert "FAKE_OPENWEATHER_KEY" not in captured[1]["content"]
    assert "не вероятность" in ai_assistant.SYSTEM_PROMPT.lower()
    assert "forecast_5day" in ai_assistant.SYSTEM_PROMPT

    captured.clear()
    calls.clear()
    more = client.post("/api/ai/chat", json={
        "field_id": 1, "message": "Когда завтра будет холодно по часам?"
    })
    assert more.status_code == 200, more.text
    context2 = json.loads(captured[1]["content"].split("\n", 1)[1])
    assert len(context2["forecast_5day"]["days"][1]["forecast_intervals_3h"]) == 8
