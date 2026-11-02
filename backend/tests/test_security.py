"""Live auth guard regressions, no external services or real secrets."""
import pytest
from fastapi.testclient import TestClient
from app import auth, main


pytestmark = pytest.mark.real_auth


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "PASSWORD_FILE", tmp_path / "admin_access.txt")
    monkeypatch.delenv("AGRORADAR_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("AGRORADAR_SECURE_COOKIES", raising=False)
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometry.json")
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    auth._SESSIONS.clear()
    auth._FAILED_LOGINS.clear()
    return TestClient(main.app)


def login(client):
    password = auth.admin_password()
    response = client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 200, response.text
    assert "httponly" in response.headers["set-cookie"].lower()
    assert "samesite=strict" in response.headers["set-cookie"].lower()
    assert "agroradar_session" in response.cookies
    return response.json()["csrf_token"]


def test_initial_login_and_hidden_secret(client):
    status = client.get("/api/auth/status")
    assert status.status_code == 200
    assert status.json()["authenticated"] is False
    assert status.json()["csrf_token"] is None
    assert auth.PASSWORD_FILE.exists()
    secret = auth.admin_password()
    assert len(secret) >= 20
    assert secret not in status.text
    assert client.get("/api/fields").status_code == 401
    assert client.get("/api/fields.geojson").status_code == 401
    assert client.get("/api/ai/status").status_code == 401
    assert client.get("/openapi.json").status_code == 401
    assert client.get("/api/health").status_code == 200


def test_password_login_csrf_and_logout(client):
    assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
    assert client.post("/api/fields", json={}).status_code == 401
    csrf = login(client)
    assert client.get("/api/auth/status").json()["authenticated"] is True
    assert client.get("/api/auth/status").json()["csrf_token"] == csrf
    assert client.get("/api/fields").status_code == 200
    assert client.post("/api/fields", json={}).status_code == 403
    assert client.post("/api/fields", headers={"X-Agro-CSRF": "wrong"}, json={}).status_code == 403
    assert client.post("/api/fields", headers={"X-Agro-CSRF": csrf}, json={}).status_code == 422
    assert client.post("/api/auth/logout", headers={"X-Agro-CSRF": csrf}).status_code == 200
    assert client.get("/api/fields").status_code == 401


def test_rate_limit_bad_passwords(client):
    for _ in range(8):
        assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 429
    # A correct password cannot bypass temporary login throttling.
    assert client.post("/api/auth/login", json={"password": auth.admin_password()}).status_code == 429


def test_cookie_settings_secure_mode(monkeypatch, client):
    monkeypatch.setenv("AGRORADAR_SECURE_COOKIES", "1")
    password = auth.admin_password()
    response = client.post("/api/auth/login", json={"password": password})
    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()
