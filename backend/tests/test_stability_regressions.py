"""Defensive regressions for difficult field-boundary and task inputs.

All writes are isolated in pytest tmp_path. No real API keys or Internet used.
"""
import io
import json
import zipfile
import sqlite3
import pytest

from fastapi.testclient import TestClient
from app import main, monitoring, backups


def test_geometry_rejects_self_touching_overlapping_and_repeated_vertices(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometries.json")
    monkeypatch.setattr(backups, "BACKUP_DIR", tmp_path / "backups")
    client = TestClient(main.app)

    invalid = [
        # The last interior vertex touches the non-adjacent bottom edge.
        [[36.50, 50.50], [36.53, 50.50], [36.53, 50.53],
         [36.515, 50.50], [36.50, 50.53]],
        # The first two adjacent edges overlap (backtrack on one another).
        [[36.50, 50.50], [36.53, 50.50], [36.51, 50.50],
         [36.51, 50.52], [36.50, 50.52]],
        # A non-adjacent corner is visited twice.
        [[36.50, 50.50], [36.53, 50.50], [36.53, 50.53],
         [36.52, 50.52], [36.53, 50.50], [36.50, 50.53]],
    ]
    for ring in invalid:
        response = client.put("/api/fields/1/geometry", json={"coordinates": ring})
        assert response.status_code == 422, (ring, response.text)
    assert not (tmp_path / "fields.json").exists()

    # Harmless subdivision of a straight edge is legal.
    valid = [[36.50, 50.50], [36.51, 50.50], [36.53, 50.50],
             [36.53, 50.52], [36.50, 50.52]]
    response = client.put("/api/fields/1/geometry", json={"coordinates": valid})
    assert response.status_code == 200, response.text


def test_task_date_rejects_noncanonical_iso_while_accepting_standard(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometries.json")
    monkeypatch.setattr(monitoring, "DATABASE_FILE", tmp_path / "mon.sqlite3")
    monkeypatch.setattr(backups, "BACKUP_DIR", tmp_path / "backups")
    client = TestClient(main.app)
    payload = {
        "field_id": 1, "title": "Осмотр поля", "action": "Проверить состояние листьев",
        "due_date": "20261120"
    }
    rejected = client.post("/api/operations/tasks", json=payload)
    assert rejected.status_code == 422, rejected.text
    payload["due_date"] = "2026-11-20"
    valid = client.post("/api/operations/tasks", json=payload)
    assert valid.status_code == 201, valid.text
    assert valid.json()["task"]["due_date"] == "2026-11-20"


def test_backup_manifest_matches_files_really_in_archive(monkeypatch, tmp_path):
    monkeypatch.setattr(backups, "DATA_DIR", tmp_path)
    monkeypatch.setattr(backups, "BACKUP_DIR", tmp_path / "backups")
    client = TestClient(main.app)

    empty = client.get("/api/admin/backup")
    assert empty.status_code == 200
    with zipfile.ZipFile(io.BytesIO(empty.content)) as bundle:
        manifest = json.loads(bundle.read("BACKUP_README.json"))
        assert manifest["included"] == []
        assert bundle.namelist() == ["BACKUP_README.json"]

    (tmp_path / "fields.json").write_text('{"version":1,"fields":[],"next_id":1}', encoding="utf-8")
    populated = client.get("/api/admin/backup")
    assert populated.status_code == 200
    with zipfile.ZipFile(io.BytesIO(populated.content)) as bundle:
        manifest = json.loads(bundle.read("BACKUP_README.json"))
        assert manifest["included"] == ["fields.json"]
        assert "data/fields.json" in bundle.namelist()
        assert "data/monitoring.sqlite3" not in bundle.namelist()


def test_system_endpoint_reports_running_api_version():
    client = TestClient(main.app)
    response = client.get("/api/admin/system")
    assert response.status_code == 200
    assert response.json()["version"] == main.app.version


def test_sqlite_connection_closes_if_schema_setup_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(monitoring, "DATABASE_FILE", tmp_path / "broken.sqlite3")
    events = []

    class BrokenConnection:
        row_factory = None

        def execute(self, _statement):
            return None

        def executescript(self, _statement):
            raise sqlite3.DatabaseError("simulated schema failure")

        def close(self):
            events.append("closed")

    monkeypatch.setattr(monitoring.sqlite3, "connect", lambda *args, **kwargs: BrokenConnection())
    with pytest.raises(sqlite3.DatabaseError, match="simulated schema failure"):
        with monitoring.connection():
            pass
    assert events == ["closed"]
