"""Five-day weather screening and dated forecast-archive regression tests."""
import sqlite3
import time

from fastapi.testclient import TestClient

from app import main, monitoring
from app.five_day import build_five_day_forecast


def weather_points(now):
    points = []
    for i in range(40):
        day = i // 8
        points.append({
            "timestamp": now + 3600 + i * 10800,
            "temperature_c": -3 if day == 1 else 18,
            "minimum_temperature_c": -4 if day == 1 else 17,
            "humidity_pct": 60,
            "rain_mm_3h": 4.0 if day == 2 else 0.0,
            "wind_ms": 3.0,
            "wind_gust_ms": 5.0,
        })
    return points


def test_each_of_five_days_has_its_own_rainfall_and_frost_risk():
    now = 1800000000
    forecast = build_five_day_forecast(weather_points(now), "openweather_forecast_3h",
                                       {"crop": "Пшеница"}, issued_at=now)
    assert len(forecast["days"]) == 5
    assert [item["sample_count"] for item in forecast["days"]] == [8, 8, 8, 8, 8]
    assert [item["risk"]["level"] for item in forecast["days"]] == [
        "low", "high", "high", "low", "low"
    ]
    assert forecast["days"][2]["precipitation_mm"] == 32
    assert forecast["days"][0]["precipitation_mm"] == 0
    assert forecast["days"][1]["min_temperature_c"] == -4


def test_missing_later_days_remain_unknown_not_low():
    now = 1800000000
    forecast = build_five_day_forecast(weather_points(now)[:2],
                                       "openweather_forecast_3h", issued_at=now)
    assert forecast["days"][0]["sample_count"] == 2
    assert all(item["risk"]["level"] == "unknown" for item in forecast["days"][1:])
    assert all(item["unknown_count"] == 4 for item in forecast["days"][1:])


def test_live_forecasts_are_archived_by_utc_day_without_duplicates(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENWEATHER_API_KEY", "TEST_ONLY")
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometry.json")
    monkeypatch.setattr(monitoring, "DATABASE_FILE", tmp_path / "monitoring.sqlite3")
    now = int(time.time())
    # Set the first point slightly in the future, matching OpenWeather 3h cadence.
    timestamps = [now + 3600 + 10800 * i for i in range(40)]

    async def fake_request(endpoint, field, key):
        assert key == "TEST_ONLY"
        if endpoint == "weather":
            return {"main": {"temp": 12, "humidity": 60},
                    "wind": {"speed": 3}, "dt": now}
        return {"list": [
            {"dt": dt, "main": {"temp": 10, "temp_min": 9, "humidity": 65},
             "wind": {"speed": 3, "gust": 5}, "rain": {"3h": 0},
             "pop": 0.1}
            for dt in timestamps
        ]}

    monkeypatch.setattr(main, "_openweather_request", fake_request)
    main._CACHE.clear()
    client = TestClient(main.app)
    response = client.get("/api/dashboard")
    assert response.status_code == 200, response.text
    field = response.json()["fields"][0]
    assert len(field["five_day_forecast"]["days"]) == 5
    assert len(field["forecast"]["points"]) <= 8  # old 24h API is intact
    archive_response = client.get("/api/operations/fields/1/forecast-archive")
    assert archive_response.status_code == 200, archive_response.text
    entries = archive_response.json()["entries"]
    assert len(entries) == 1
    assert entries[0]["source"] == "openweather_forecast_3h"
    assert len(entries[0]["forecast"]["days"]) == 5
    assert entries[0]["forecast"]["days"][0]["points"]
    assert "TEST_ONLY" not in str(entries)

    assert client.get("/api/dashboard").status_code == 200
    with sqlite3.connect(str(monitoring.DATABASE_FILE)) as db:
        assert db.execute("SELECT COUNT(*) FROM forecast_archives WHERE field_id=1").fetchone()[0] == 1


def test_demo_is_not_misrepresented_as_archived_real_weather(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometry.json")
    monkeypatch.setattr(monitoring, "DATABASE_FILE", tmp_path / "monitoring.sqlite3")
    client = TestClient(main.app)
    resp = client.get("/api/dashboard")
    assert resp.status_code == 200
    field = resp.json()["fields"][0]
    assert field["five_day_forecast"]["source"] == "demo"
    assert len(field["five_day_forecast"]["days"]) == 5
    assert client.get("/api/operations/fields/1/forecast-archive").json()["entries"] == []
