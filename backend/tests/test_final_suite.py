"""Final-suite tests: persistent history, live alerts, reports, backups and security."""
import io
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import auth, backups, main, monitoring
from app.risk_engine import analyze_risks


@pytest.fixture
def client(monkeypatch, tmp_path):
    folder = tmp_path / "data"
    folder.mkdir()
    monkeypatch.setattr(main, "CATALOG_FILE", folder / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", folder / "field_geometries.json")
    monkeypatch.setattr(monitoring, "DATABASE_FILE", folder / "monitoring.sqlite3")
    monkeypatch.setattr(backups, "DATA_DIR", folder)
    monkeypatch.setattr(backups, "BACKUP_DIR", folder / "backups")
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    main._CACHE.clear()
    return TestClient(main.app)


def test_dashboard_persists_tagged_demo_history_idempotently(client):
    first = client.get("/api/dashboard")
    assert first.status_code == 200, first.text
    assert first.json()["count"] == 4
    second = client.get("/api/dashboard")
    assert second.status_code == 200
    summary = client.get("/api/operations/summary").json()
    assert summary["monitored_fields"] == 4
    assert summary["open_alerts"] == 0   # demo must NEVER create operational warnings
    history = client.get("/api/operations/fields/1/history").json()
    assert len(history["snapshots"]) == 1
    assert history["snapshots"][0]["source"] == "demo"
    assert client.get("/api/operations/alerts").json()["alerts"] == []


def live_field(field, *, level="high"):
    points = [
        {"temperature_c": -4 if level == "high" else 4,
         "humidity_pct": 70, "rain_mm_3h": 0,
         "wind_ms": 4, "wind_gust_ms": 6}
    ] * 8
    minimum = -4 if level == "high" else 4
    forecast = {"source": "openweather_forecast_3h",
                "points": points, "min_temperature_next_24h_c": minimum,
                "period_hours": 24, "sample_count": 8}
    weather = {"source": "openweather_current",
               "temperature_c": 6, "humidity_pct": 70, "wind_ms": 4}
    analysis = analyze_risks(weather, forecast, field)
    return {**field, "weather": weather, "forecast": forecast,
            "risk": analysis["overall"], "risk_analysis": analysis}


def test_live_alert_acknowledge_and_resolve(client, monkeypatch):
    monkeypatch.setenv("OPENWEATHER_API_KEY", "TEST_ONLY")
    state = {"level": "high"}

    async def compose(field):
        return live_field(field, level=state["level"])

    monkeypatch.setattr(main, "compose_field_resilient", compose)
    # dashboard captures LIVE warning signals; no provider API is called.
    assert client.get("/api/dashboard").status_code == 200
    alerts = client.get("/api/operations/alerts?status=open").json()["alerts"]
    assert alerts
    frost = next(row for row in alerts if row["field_id"] == 1 and row["factor"] == "frost")
    csrf = {"X-Agro-CSRF": "test-csrf"}
    response = client.put(f"/api/operations/alerts/{frost['id']}",
                          headers=csrf, json={"status": "acknowledged"})
    assert response.status_code == 200, response.text
    assert any(row["id"] == frost["id"] for row in
               client.get("/api/operations/alerts?status=acknowledged").json()["alerts"])
    state["level"] = "low"
    assert client.get("/api/dashboard").status_code == 200
    resolved = client.get("/api/operations/alerts?status=resolved").json()["alerts"]
    assert any(row["id"] == frost["id"] for row in resolved)
    assert client.put(f"/api/operations/alerts/{frost['id']}",
                      headers=csrf, json={"status": "acknowledged"}).status_code == 409


def test_printable_report_escapes_html_and_csv_excel_formulas(client):
    response = client.put("/api/fields/1", json={
        "name": "=SUM(1+1)", "crop": "<script>alert('x')</script>",
        "description": "<img src=x onerror=alert(1)>"
    })
    assert response.status_code == 200, response.text
    html = client.get("/api/reports/field/1")
    assert html.status_code == 200, html.text
    assert "text/html" in html.headers["content-type"]
    assert "<script>alert('x')</script>" not in html.text
    assert "&lt;script&gt;" in html.text
    assert "window.print()" in html.text
    assert "Content-Security-Policy" in html.headers
    report = client.get("/api/reports/field/1.csv")
    assert report.status_code == 200, report.text
    assert report.content.startswith(b"\xef\xbb\xbf")
    assert "'=SUM(1+1)" in report.text
    overview = client.get("/api/reports/overview.csv")
    assert overview.status_code == 200
    assert "'=SUM(1+1)" in overview.text


def test_prechange_backups_and_private_zip_export(client, monkeypatch):
    assert client.get("/api/dashboard").status_code == 200
    assert client.put("/api/fields/1", json={"name":"Первое", "crop":"Пшеница"}).status_code == 200
    assert client.put("/api/fields/1", json={"name":"Второе", "crop":"Пшеница"}).status_code == 200
    assert client.put("/api/fields/1", json={"name":"Третье", "crop":"Пшеница"}).status_code == 200
    archives = list(backups.BACKUP_DIR.glob("fields.json.*.bak"))
    assert len(archives) == 2
    assert json.loads(archives[0].read_text(encoding="utf-8"))["fields"]
    (backups.DATA_DIR / "admin_access.txt").write_text("SECRET_DO_NOT_EXPORT", encoding="utf-8")
    (backups.DATA_DIR / "viewer_accounts.json").write_text("SECRET_HASH_DO_NOT_EXPORT", encoding="utf-8")
    zip_resp = client.get("/api/admin/backup")
    assert zip_resp.status_code == 200
    with zipfile.ZipFile(io.BytesIO(zip_resp.content)) as package:
        names = package.namelist()
        assert "data/fields.json" in names
        assert "data/monitoring.sqlite3" in names
        assert "BACKUP_README.json" in names
        assert "data/admin_access.txt" not in names
        assert "data/viewer_accounts.json" not in names
        assert b"SECRET_DO_NOT_EXPORT" not in zip_resp.content
    assert client.get("/api/admin/system").status_code == 200


def test_activity_log_tracks_mutations_without_storing_notes(client):
    text = "СЕКРЕТНЫЕ ПОЛЕВЫЕ ЗАМЕТКИ"
    assert client.post("/api/fields/1/observations", json={"text": text}).status_code == 201
    logs = client.get("/api/operations/activity").json()["events"]
    assert any(event["action"] == "observation_added" and event["field_id"] == 1 for event in logs)
    assert text not in json.dumps(logs, ensure_ascii=False)


@pytest.mark.real_auth
def test_viewer_can_download_reports_but_cannot_change_alert_or_get_backup(monkeypatch, tmp_path):
    folder = tmp_path / "store"; folder.mkdir()
    monkeypatch.setattr(main, "CATALOG_FILE", folder / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", folder / "geometry.json")
    monkeypatch.setattr(monitoring, "DATABASE_FILE", folder / "monitoring.sqlite3")
    monkeypatch.setattr(backups, "DATA_DIR", folder)
    monkeypatch.setattr(backups, "BACKUP_DIR", folder / "backups")
    monkeypatch.setattr(auth, "PASSWORD_FILE", folder / "admin_access.txt")
    monkeypatch.setattr(auth, "USERS_FILE", folder / "viewer_accounts.json")
    monkeypatch.delenv("AGRORADAR_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    auth._SESSIONS.clear()
    auth._FAILED_LOGINS.clear()
    admin = TestClient(main.app)
    admin_login = admin.post("/api/auth/login", json={"password": auth.admin_password()}).json()
    admin_csrf = {"X-Agro-CSRF": admin_login["csrf_token"]}
    created = admin.post("/api/auth/users", headers=admin_csrf,
                         json={"username": "test_viewer", "password": "separate-long-password"})
    assert created.status_code == 201, created.text
    viewer = TestClient(main.app)
    login = viewer.post("/api/auth/login", json={"username": "test_viewer",
                                                 "password": "separate-long-password"})
    assert login.status_code == 200
    assert viewer.get("/api/dashboard").status_code == 200
    assert viewer.get("/api/operations/summary").status_code == 200
    assert viewer.get("/api/reports/overview.csv").status_code == 200
    assert viewer.get("/api/reports/field/1").status_code == 200
    assert viewer.get("/api/admin/backup").status_code == 403
    assert viewer.get("/api/admin/system").status_code == 403
    assert viewer.get("/api/operations/activity").status_code == 403
    assert viewer.put("/api/operations/alerts/1", headers={"X-Agro-CSRF": login.json()["csrf_token"]},
                      json={"status":"acknowledged"}).status_code == 403


def test_history_records_500_fields_without_external_calls(client):
    fields = [
        live_field({"id": n, "name": f"Участок {n}", "crop": "Пшеница"})
        for n in range(1, 501)
    ]
    result = monitoring.capture_dashboard(fields)
    assert result["snapshots_added"] == 500
    assert monitoring.summary()["monitored_fields"] == 500
    assert monitoring.capture_dashboard(fields)["snapshots_added"] == 0
    assert len(monitoring.field_history(500)["snapshots"]) == 1
