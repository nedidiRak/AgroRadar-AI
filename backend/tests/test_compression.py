"""Wire representations must deliver the same application data to old and new clients."""
import gzip

from fastapi.testclient import TestClient
import pytest

from app import main


@pytest.mark.parametrize(("encoding", "compressed"), [
    ("gzip, deflate, br", True), ("GZIP;q=0.8", True), ("*;q=0.5", True),
    ("identity", False), ("br", False), ("gzip;q=0, *;q=1", False),
    ("gzip;q=0.3, identity;q=1", False),
])
def test_field_map_content_matches_identity(monkeypatch, tmp_path, encoding, compressed):
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometry.json")
    with TestClient(main.app) as client:
        route = "/api/fields.geojson"
        expected = client.get(route, headers={"Accept-Encoding": "identity"})
        assert expected.status_code == 200
        assert len(expected.json()["features"]) == 4
        assert len(expected.content) > 1024
        with client.stream("GET", route, headers={"Accept-Encoding": encoding}) as response:
            assert response.status_code == 200
            assert response.headers["cache-control"] == "no-store"
            assert "accept-encoding" in response.headers["vary"].lower()
            wire = b"".join(response.iter_raw())
            if compressed:
                assert response.headers["content-encoding"] == "gzip"
                assert len(wire) < len(expected.content)
                assert gzip.decompress(wire) == expected.content
            else:
                assert "content-encoding" not in response.headers
                assert wire == expected.content


@pytest.mark.parametrize("route", ["/api/health", "/api/auth/status"])
def test_small_responses_are_not_compressed(route):
    with TestClient(main.app) as client:
        response = client.get(route, headers={"Accept-Encoding": "gzip"})
        assert response.status_code == 200
        assert "content-encoding" not in response.headers
