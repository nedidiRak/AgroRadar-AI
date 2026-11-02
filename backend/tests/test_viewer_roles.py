"""Role-based permissions and persistent viewer accounts, offline tests."""
import json
import pytest
from fastapi.testclient import TestClient
from app import auth, main

pytestmark = pytest.mark.real_auth

@pytest.fixture
def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(auth, "PASSWORD_FILE", tmp_path / "admin_access.txt")
    monkeypatch.setattr(auth, "USERS_FILE", tmp_path / "viewer_accounts.json")
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geo.json")
    monkeypatch.delenv("AGRORADAR_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    auth._SESSIONS.clear()
    auth._FAILED_LOGINS.clear()
    return tmp_path

def authenticate(client, username, password):
    response = client.post("/api/auth/login", json={"username":username,"password":password})
    assert response.status_code == 200, response.text
    return response.json()["csrf_token"]

def test_viewer_can_read_and_chat_but_cannot_write(setup, monkeypatch):
    admin = TestClient(main.app)
    admin_csrf = authenticate(admin, "admin", auth.admin_password())
    created = admin.post("/api/auth/users", headers={"X-Agro-CSRF":admin_csrf},
                         json={"username":"agronom_1", "password":"different-long-pass"})
    assert created.status_code == 201, created.text
    assert "password" not in created.text and "hash" not in created.text
    raw = json.loads(auth.USERS_FILE.read_text(encoding="utf-8"))
    assert "different-long-pass" not in auth.USERS_FILE.read_text(encoding="utf-8")
    assert raw["users"]["agronom_1"]["hash"]
    viewer = TestClient(main.app)
    csrf = authenticate(viewer, "agronom_1", "different-long-pass")
    info = viewer.get("/api/auth/status").json()
    assert info["role"] == "viewer"
    assert info["username"] == "agronom_1"
    assert viewer.get("/api/dashboard").status_code == 200
    assert viewer.get("/api/fields.geojson").status_code == 200
    assert viewer.get("/api/fields/1/risks").status_code == 200
    assert viewer.get("/api/auth/users").status_code == 403
    assert viewer.get("/openapi.json").status_code == 401  # session cookie scoped to /api
    mutations = [
        ("POST", "/api/fields", {"name":"other","crop":"Соя","coordinates":[]}),
        ("PUT", "/api/fields/1", {"name":"x","crop":"y"}),
        ("DELETE", "/api/fields/1", None),
        ("PUT", "/api/fields/1/geometry", {"coordinates":[]}),
        ("DELETE", "/api/fields/1/geometry", None),
        ("POST", "/api/fields/1/observations", {"text":"изменить"}),
        ("DELETE", "/api/fields/1/observations/123", None),
        ("POST", "/api/auth/users", {"username":"new","password":"strong-pass-123"}),
    ]
    for method, path, data in mutations:
        response = viewer.request(method, path, headers={"X-Agro-CSRF":csrf}, json=data)
        assert response.status_code == 403, (method, path, response.text)
    monkeypatch.setenv("DEEPSEEK_API_KEY", "TEST_ONLY")
    from app import ai_assistant
    async def fake_ai(messages, api_key, model):
        return {"answer":"Обследуйте поле.", "model":model, "usage":{}}
    monkeypatch.setattr(ai_assistant,"request_deepseek",fake_ai)
    chat = viewer.post("/api/ai/chat", headers={"X-Agro-CSRF":csrf},
                       json={"field_id":1,"message":"Что проверить?"})
    assert chat.status_code == 200, chat.text
    assert viewer.post("/api/ai/chat",json={"field_id":1,"message":"Что проверить?"}).status_code == 403

def test_viewer_password_change_revokes_sessions_and_delete(setup):
    admin = TestClient(main.app)
    csrf = authenticate(admin, "admin", auth.admin_password())
    headers = {"X-Agro-CSRF":csrf}
    assert admin.post("/api/auth/users",headers=headers,json={"username":"field_user","password":"first-strong-pass"}).status_code == 201
    other = TestClient(main.app)
    authenticate(other,"field_user","first-strong-pass")
    assert other.get("/api/dashboard").status_code == 200
    reset = admin.put("/api/auth/users/field_user/password",headers=headers,json={"password":"second-strong-pass"})
    assert reset.status_code == 200
    assert other.get("/api/dashboard").status_code == 401
    assert other.post("/api/auth/login",json={"username":"field_user","password":"first-strong-pass"}).status_code == 401
    authenticate(other,"field_user","second-strong-pass")
    assert admin.get("/api/auth/users").json()["users"][0]["username"] == "field_user"
    assert admin.delete("/api/auth/users/field_user",headers=headers).status_code == 200
    assert other.get("/api/dashboard").status_code == 401
    assert admin.get("/api/auth/users").json()["users"] == []
    assert admin.get("/api/dashboard").status_code == 200

def test_credentials_persist_without_storing_plaintext(setup):
    admin = TestClient(main.app)
    csrf = authenticate(admin,"admin",auth.admin_password())
    result = admin.post("/api/auth/users",headers={"X-Agro-CSRF":csrf},
                        json={"username":"stored_viewer","password":"a-long-passphrase"})
    assert result.status_code == 201
    auth._SESSIONS.clear()
    auth._FAILED_LOGINS.clear()
    viewer = TestClient(main.app)
    authenticate(viewer,"stored_viewer","a-long-passphrase")
    assert viewer.get("/api/fields").status_code == 200

def test_name_validation_duplicate_and_admin_compatibility(setup):
    admin = TestClient(main.app)
    # Prior releases only supplied password, which must continue to work.
    res = admin.post("/api/auth/login",json={"password":auth.admin_password()})
    assert res.status_code == 200
    csrf=res.json()["csrf_token"]
    headers={"X-Agro-CSRF":csrf}
    assert admin.post("/api/auth/users",headers=headers,json={"username":"admin","password":"strong-password"}).status_code == 409
    assert admin.post("/api/auth/users",headers=headers,json={"username":"bad user","password":"strong-password"}).status_code == 422
    assert admin.post("/api/auth/users",headers=headers,json={"username":"valid_user","password":"strong-password"}).status_code == 201
    assert admin.post("/api/auth/users",headers=headers,json={"username":"VALID_USER","password":"strong-password"}).status_code == 409
    assert admin.get("/api/auth/status").json()["role"] == "admin"
