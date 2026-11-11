"""Proof for the customer: create 500 REAL fields through public CRUD API.

Uses isolated temporary catalog and geometry; never touches the user's files.
Unlike the prior 500-history test, this exercises 500 POST writes, indexes/IDs,
geo-area validation, filesystem persistence and field/GeoJSON readback.
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main, backups, monitoring


@pytest.mark.slow
def test_create_read_restart_500_user_fields(monkeypatch, tmp_path, capsys):
    data = tmp_path / "isolated"
    data.mkdir()
    monkeypatch.setattr(main, "CATALOG_FILE", data / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", data / "field_geometries.json")
    monkeypatch.setattr(backups, "BACKUP_DIR", data / "backups")
    monkeypatch.setattr(monitoring, "DATABASE_FILE", data / "monitoring.sqlite3")
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    main._CACHE.clear()
    client = TestClient(main.app)

    start = time.perf_counter()
    for index in range(500):
        row, col = divmod(index, 25)
        lon = round(35.05 + col * 0.025, 6)
        lat = round(49.05 + row * 0.025, 6)
        size = 0.003
        ring = [
            [lon, lat], [lon + size, lat], [lon + size, lat + size],
            [lon, lat + size], [lon, lat],
        ]
        created = client.post("/api/fields", json={
            "name": f"Нагрузочное поле {index + 1:03d}", "crop": "Пшеница",
            "description": "Изолированное тестовое поле, не реальное хозяйство.",
            "coordinates": ring, "growth_stage": "кущение", "soil_type": "чернозём",
        })
        assert created.status_code == 201, f"{index}: {created.text[:400]}"
        body = created.json()["field"]
        assert body["id"] == 5 + index
        assert body["area_ha"] > 0
        assert body["geometry_source"] == "user_drawn"
    create_seconds = time.perf_counter() - start

    reading = time.perf_counter()
    catalog = client.get("/api/fields")
    assert catalog.status_code == 200
    fields = catalog.json()
    assert len(fields) == 504  # Four original demonstration fields are preserved.
    assert len({field["id"] for field in fields}) == 504
    assert len({field["name"].casefold() for field in fields}) == 504
    assert sum(field["kind"] == "user" for field in fields) == 500
    geometry = client.get("/api/fields.geojson")
    assert geometry.status_code == 200
    features = geometry.json()["features"]
    assert len(features) == 504
    assert sum(feature["properties"]["geometry_source"] == "user_drawn" for feature in features) == 500
    read_seconds = time.perf_counter() - reading

    # A different client forces full disk readback; no Python function mock.
    reopened = TestClient(main.app)
    last = reopened.get("/api/fields/504")
    assert last.status_code == 200
    assert last.json()["name"] == "Нагрузочное поле 500"
    assert last.json()["growth_stage"] == "кущение"
    saved = json.loads((data / "fields.json").read_text(encoding="utf-8"))
    assert len(saved["fields"]) == 504
    assert saved["next_id"] >= 505
    # Backup rotation must remain bounded even after 500 writes.
    assert len(list((data / "backups").glob("fields.json.*.bak"))) <= 15

    elapsed = time.perf_counter() - start
    print(
        "\nAGRO_500_PROOF "
        f"created=500 saved=504 geojson=504 "
        f"create_seconds={create_seconds:.3f} read_seconds={read_seconds:.3f} "
        f"total_seconds={elapsed:.3f} max_create_rate_per_second={500/max(create_seconds,0.001):.2f}",
        flush=True,
    )


@pytest.mark.slow
def test_parallel_20_field_creations_keep_unique_ids(monkeypatch, tmp_path):
    data = tmp_path / "parallel"
    data.mkdir()
    monkeypatch.setattr(main, "CATALOG_FILE", data / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", data / "field_geometries.json")
    monkeypatch.setattr(backups, "BACKUP_DIR", data / "backups")
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)

    def create(index: int):
        lat = 51.0 + index * 0.015
        lon = 37.0
        with TestClient(main.app) as client:
            return client.post("/api/fields", json={
                "name": f"Concurrent {index}", "crop": "Пшеница",
                "coordinates": [[lon, lat], [lon+.002,lat], [lon+.002,lat+.002],
                                [lon,lat+.002],[lon,lat]],
            })

    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(create, range(20)))
    assert all(response.status_code == 201 for response in responses), [
        (response.status_code, response.text[:150]) for response in responses if response.status_code != 201
    ]
    saved = json.loads((data / "fields.json").read_text(encoding="utf-8"))["fields"]
    assert len(saved) == 24
    assert len({row["id"] for row in saved}) == 24
