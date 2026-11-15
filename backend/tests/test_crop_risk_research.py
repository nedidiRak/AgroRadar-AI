"""Crop-specific research layer: safety, source provenance and backward compatibility."""
from fastapi.testclient import TestClient
from app.crop_risk import (
    catalog, crop_stages, evaluate_crop_risk, resolve_crop_id, rules_version,
)
from app.risk_engine import analyze_risks
from app import main


def weather(*temps, source="openweather_forecast_3h"):
    points = [{"timestamp": 1800000000 + i * 10800, "temperature_c": t}
              for i, t in enumerate(temps)]
    return {"source": source, "points": points, "period_hours": 24,
            "min_temperature_next_24h_c": min(temps) if temps else None}


def selection(crop_id, stage):
    return {"crop_id": crop_id, "crop_stage_code": stage}


def test_research_catalog_is_reconstructed_and_not_approved():
    data = catalog()
    assert len(data["crops"]) == 50
    assert len(data["rules"]) == 85
    assert sum(r["interpretation"] == "unknown" for r in data["rules"]) == 50
    assert rules_version()["approved_rules"] == 0
    assert all(r["rule_id"] and "source_ids" in r for r in data["rules"])


def test_ambiguous_legacy_crop_never_guesses_winter_or_spring():
    assert resolve_crop_id("Пшеница") is None
    assert resolve_crop_id("Кукуруза") is None
    assert resolve_crop_id("Пшеница озимая") == "winter_wheat"
    assert resolve_crop_id("Соя") == "soybean"
    assert resolve_crop_id("Явно нет", "never_a_real_crop") is None


def test_same_temperature_different_crop_evidence():
    incoming = weather(34, 34, 34, 34, 34, 34, 34, 34)
    wheat = evaluate_crop_risk(selection("winter_wheat", "flowering"), incoming)
    soy = evaluate_crop_risk(selection("soybean", "flowering"), incoming)
    assert wheat["overall"]["level"] == "medium"
    assert wheat["assessments"][0]["rule_id"] == "R0002"
    assert wheat["assessments"][0]["source_urls"]
    # Soy's controlled 14-day exposure cannot be inferred from 3-hour samples.
    assert soy["overall"]["level"] == "unknown"
    assert soy["assessments"][0]["level"] == "unknown"


def test_soil_temperature_is_not_air_temperature():
    cold = weather(1, 2, 3, 4, 5, 4, 3, 2)
    maize = evaluate_crop_risk(selection("grain_maize", "germination_imbibition"), cold)
    assert maize["overall"]["level"] == "unknown"
    assert maize["assessments"][0]["measurement_type"] == "soil_temperature_5cm"
    assert maize["assessments"][0]["level"] == "unknown"


def test_sunflower_inflorescence_not_air_temperature():
    hot = weather(44, 44, 44, 44)
    sunflower = evaluate_crop_risk(selection("sunflower", "anthesis"), hot)
    assert sunflower["overall"]["level"] == "unknown"
    assert sunflower["assessments"][0]["level"] == "unknown"


def test_missing_stage_or_unknown_crop_are_grey():
    for field in (
        {"crop_id": "grain_maize"},
        {"crop": "Пшеница", "crop_stage_code": "flowering"},
        {"crop_id": "does_not_exist", "crop_stage_code": "flowering"},
    ):
        result = evaluate_crop_risk(field, weather(35, 35, 35))
        assert result["overall"]["level"] == "unknown"
        assert not result["assessments"]


def test_non_numeric_weather_does_not_trigger_warning():
    incoming = {"source": "openweather_forecast_3h",
                "points": [{"temperature_c": None}, {"temperature_c": "42"},
                           {"temperature_c": float("nan")}, {"temperature_c": True}]}
    result = evaluate_crop_risk(selection("winter_wheat", "flowering"), incoming)
    assert result["overall"]["level"] == "unknown"
    assert result["assessments"][0]["level"] == "unknown"


def test_only_yellow_candidate_no_red_without_approval():
    hot = weather(36, 36, 36)
    cases = [("winter_wheat", "flowering"),
             ("grain_maize", "pollination"), ("silage_maize", "pollination")]
    for crop_id, stage in cases:
        result = evaluate_crop_risk(selection(crop_id, stage), hot)
        assert result["approved_rules"] == 0
        assert result["overall"]["level"] in ("unknown", "medium")
        assert all(a["level"] in ("medium", "unknown") for a in result["assessments"])


def test_unchanged_weather_risk_contract():
    old = analyze_risks({}, {"source": "demo", "points": [
        {"temperature_c": 36, "humidity_pct": 28, "rain_mm_3h": 0,
         "wind_ms": 3, "wind_gust_ms": 5}] * 8,
        "min_temperature_next_24h_c": 5, "period_hours": 24})
    assert old["version"] == "3.0"
    assert [a["id"] for a in old["assessments"]] == ["frost", "rain", "wind", "dry_heat"]


def test_read_only_catalog_endpoints_and_field_extension(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "field_geometries.json")
    client = TestClient(main.app)
    items = client.get("/api/crops").json()
    assert items["count"] == 50
    assert len(client.get("/api/crops/winter_wheat/phenology").json()["stages"]) >= 1
    assert client.get("/api/risk-rules/version").json()["approved_rules"] == 0
    assert client.get("/api/risk-rules/R0013").json()["rule"]["measurement_type"] == "soil_temperature_5cm"
    assert client.get("/api/risk-rules/NOT_PRESENT").status_code == 404

    original = client.get("/api/fields/1/risks").json()
    response = client.put("/api/fields/1", json={
        "name": "Поле Северное", "crop": "Пшеница озимая",
        "crop_id": "winter_wheat", "crop_stage_code": "flowering",
        "growth_stage": "Цветение",
    })
    assert response.status_code == 200, response.text
    latest = client.get("/api/fields/1/risks").json()
    assert latest["risk_analysis"]["version"] == "3.0"
    assert latest["risk_analysis"]["assessments"] == original["risk_analysis"]["assessments"]
    assert latest["crop_risk_analysis"]["crop_id"] == "winter_wheat"
    assert latest["crop_risk_analysis"]["simulated"] is True
    five = client.get("/api/fields/1/five-day-forecast").json()
    assert len(five["days"]) == 5
    assert five["days"][0]["crop_risk_analysis"]["crop_id"] == "winter_wheat"
    assert client.put("/api/fields/1", json={
        "name": "Поле Северное", "crop": "Пшеница озимая",
        "crop_id": "grain_maize", "crop_stage_code": "pollination",
    }).status_code == 422


def test_manually_submitted_forecasts_always_marked_simulated():
    client = TestClient(main.app)
    request = {"crop_id": "winter_wheat", "crop_stage_code": "flowering",
               "source": "scenario", "points": [{"temperature_c": 34}]}
    result = client.post("/api/risks/evaluate", json=request)
    assert result.status_code == 200
    assert result.json()["simulated"] is True
    request["source"] = "openweather_forecast_3h"
    assert client.post("/api/risks/evaluate", json=request).status_code == 422
