"""AgroRisk 3.0: offline decision support, provenance, safety and compatibility."""
import json
from fastapi.testclient import TestClient
from app import main, ai_assistant
from app.risk_engine import analyze_risks, simulate_scenario


def point(temp=10, humidity=60, rain=0.0, wind=3.0, gust=5.0):
    return {"temperature_c": temp, "humidity_pct": humidity,
            "rain_mm_3h": rain, "wind_ms": wind, "wind_gust_ms": gust}


def weather_forecast(points, min_temp, source="openweather_forecast_3h"):
    return {"source": source, "points": points, "sample_count": len(points),
            "period_hours": 24, "min_temperature_next_24h_c": min_temp}


def test_version_and_legacy_weather_level_are_unchanged():
    result = analyze_risks({}, weather_forecast([point()] * 8, 5))
    assert result["version"] == "3.0"
    assert result["overall"]["level"] == "low"
    assert len(result["assessments"]) == 4
    assert result["known_count"] == 4
    assert result["data_quality"]["status"] == "available"
    assert result["data_quality"]["forecast_points"] == 8
    assert result["priority_actions"][0]["id"] == "routine_monitoring"
    assert result["field_context"]["source"] == "not_selected"


def test_warnings_are_priority_ordered_and_grounded_in_rules():
    points = [point(temp=30, humidity=55, rain=4.0, wind=6.0, gust=15.0)] * 8
    analysis = analyze_risks({}, weather_forecast(points, 2.0))
    assert analysis["overall"]["level"] == "high"
    assert [item["id"] for item in analysis["priority_actions"]] == [
        "check_rain", "check_frost", "check_wind"
    ]
    assert analysis["priority_actions"][0]["level"] == "high"
    assert "Правило:" in analysis["priority_actions"][0]["evidence"]
    assert "Источ" not in analysis["priority_actions"][0]["evidence"]  # evidence has explicit singular source field
    assert "Источник:" in analysis["priority_actions"][0]["evidence"]


def test_field_context_changes_advice_but_not_meteorological_thresholds():
    points = [point(temp=-2)] * 8
    forecast = weather_forecast(points, -2)
    bare = analyze_risks({}, forecast)
    enriched = analyze_risks({}, forecast, {
        "crop": "Озимая пшеница", "growth_stage": "Кущение",
        "soil_type": "Чернозём", "sowing_date": "2026-09-20",
        "observations": [{"text": "Полевой осмотр"}],
    })
    assert bare["overall"]["level"] == enriched["overall"]["level"] == "high"
    assert bare["assessments"] == enriched["assessments"]
    assert enriched["field_context"]["growth_stage"] == "Кущение"
    assert enriched["field_context"]["observation_count"] == 1
    assert enriched["field_context"]["missing"] == []
    assert "Озимая пшеница" in enriched["priority_actions"][0]["action"]
    assert "Кущение" in enriched["priority_actions"][0]["action"]
    assert "не изменяют" in enriched["field_context"]["interpretation"]


def test_missing_weather_does_not_become_fake_low_or_high_confidence():
    forecast = weather_forecast([], None, "unavailable")
    result = analyze_risks({}, forecast, {"crop": "Соя"})
    assert result["overall"]["level"] == "unknown"
    assert result["data_quality"]["status"] == "unavailable"
    assert result["data_quality"]["unknown_factors"] == 4
    assert result["priority_actions"][0]["id"] == "verify_missing_weather"
    assert "Не считать поле безопасным" in result["priority_actions"][0]["action"]
    assert "Фаза развития" in result["field_context"]["missing"]


def test_partial_live_forecast_displays_limitations_even_if_low():
    forecast = weather_forecast([point(rain=None, humidity=None, wind=None, gust=None)], 5)
    result = analyze_risks({}, forecast, {"crop": "Пшеница"})
    assert result["overall"]["level"] == "low"
    assert result["unknown_count"] == 3
    assert result["data_quality"]["status"] == "partial"
    assert result["data_quality"]["factor_coverage_complete"] is False
    assert len(result["data_quality"]["limitations"]) >= 2
    assert result["priority_actions"][0]["id"] == "verify_missing_weather"


def test_demo_and_scenarios_never_label_reality():
    demo = analyze_risks({}, weather_forecast([point()] * 8, 4, "demo"))
    assert demo["data_quality"]["status"] == "demo"
    assert any("синтетический" in s for s in demo["data_quality"]["limitations"])
    scenario = simulate_scenario("rain")
    assert scenario["analysis"]["version"] == "3.0"
    assert scenario["analysis"]["data_quality"]["status"] == "simulation"
    assert scenario["analysis"]["field_context"]["source"] == "not_selected"
    assert scenario["analysis"]["priority_actions"][0]["id"] == "check_rain"


def test_backend_passes_actual_field_profile_to_rule_engine(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometries.json")
    client = TestClient(main.app)
    before = client.get("/api/dashboard").json()["fields"][0]
    assert before["risk_analysis"]["field_context"]["growth_stage"] is None
    resp = client.put("/api/fields/1", json={
        "name": "Поле Северное", "crop": "Пшеница",
        "growth_stage": "Всходы", "soil_type": "Чернозём",
    })
    assert resp.status_code == 200, resp.text
    after = client.get("/api/fields/1/risks").json()
    assert after["risk_analysis"]["field_context"]["growth_stage"] == "Всходы"
    assert after["risk_analysis"]["field_context"]["soil_type"] == "Чернозём"
    assert after["risk"]["level"] == before["risk"]["level"]
    assert after["risk_analysis"]["data_quality"]["status"] == "demo"


def test_ai_receives_decision_support_without_fabricated_measurements(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometries.json")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "FAKE_FOR_TEST")
    captured = []
    async def fake_ai(messages, key, model):
        captured.extend(messages)
        return {"answer": "Сначала проверьте прогноз и состояние растений.", "model": model, "usage": {}}
    monkeypatch.setattr(ai_assistant, "request_deepseek", fake_ai)
    client = TestClient(main.app)
    response = client.post("/api/ai/chat", json={"field_id": 1, "message": "Что проверить?"})
    assert response.status_code == 200, response.text
    context = json.loads(captured[1]["content"].split("\n", 1)[1])
    risks = context["weather_risks"]
    assert risks["version"] == "3.0"
    assert "priority_actions" in risks
    assert risks["data_quality"]["status"] == "demo"
    assert risks["field_context"]["source"] == "operator_entered_unverified"
