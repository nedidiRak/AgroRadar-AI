import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app import auth, main, workspace_layouts

pytestmark = pytest.mark.real_auth
URL = "/api/me/layouts"


@pytest.fixture
def users(tmp_path, monkeypatch):
    monkeypatch.setattr(workspace_layouts, "DATABASE", tmp_path / "ui.sqlite3")
    monkeypatch.setattr(auth, "USERS_FILE", tmp_path / "accounts.json")
    monkeypatch.setenv("AGRORADAR_ADMIN_PASSWORD", "layout-local-admin")
    admin = login("admin", "layout-local-admin")
    viewer_data = {"username": "layout_viewer", "password": "viewer-layout-test"}
    assert admin.post("/api/auth/users", json=viewer_data).status_code == 201
    return admin, login(**viewer_data)


def login(username, password):
    client = TestClient(main.app)
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    client.headers["X-Agro-CSRF"] = response.json()["csrf_token"]
    return client


def update(name, revision=0):
    return {"revision": revision, "workspace": {"version": 1, "active": "one", "layouts": [
        {"id": "one", "name": name, "mobile": [], "desktop": [
            {"id": "weather-1", "type": "weather", "x": 0, "y": 1, "w": 6, "h": None, "fieldId": 1, "hidden": False}
        ]}
    ]}}


def test_layouts_follow_account_on_other_devices_and_relogin(users):
    admin, viewer = users
    assert TestClient(main.app).get(URL).status_code == 401
    assert admin.put(URL, json=update("Администратор")).status_code == 200
    assert viewer.get(URL).json() == {"revision": 0, "workspace": None}
    assert viewer.put(URL, json=update("Наблюдатель")).status_code == 200
    assert viewer.put(URL, headers={"X-Agro-CSRF": ""}, json=update("без токена", 1)).status_code == 403
    assert viewer.post("/api/fields", json={}).status_code == 403
    assert viewer.post("/api/operations/tasks", json={}).status_code == 403
    assert viewer.put(URL, json={**update("wrong", 1), "account": "admin"}).status_code == 422
    assert viewer.post("/api/auth/logout").status_code == 200
    other = login("layout_viewer", "viewer-layout-test")
    assert other.get(URL).json()["workspace"] == update("Наблюдатель")["workspace"]
    assert admin.get(URL).json()["workspace"] == update("Администратор")["workspace"]
    assert admin.delete("/api/auth/users/layout_viewer").status_code == 200
    assert admin.post("/api/auth/users", json={"username": "layout_viewer", "password": "new-layout-test"}).status_code == 201
    assert login("layout_viewer", "new-layout-test").get(URL).json()["revision"] == 0


def test_stale_and_concurrent_saves_never_replace_newer_layouts(users):
    admin, _ = users
    def write(i):
        return admin.put(URL, json=update(str(i))).status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sorted(pool.map(write, range(4))) == [200, 409, 409, 409]
    assert admin.put(URL, json=update("next", 1)).json() == {"revision": 2}
    assert admin.put(URL, json=update("old tab", 1)).status_code == 409
    assert admin.get(URL).json()["workspace"] == update("next")["workspace"]


def test_invalid_documents_and_explicit_recovery(users):
    admin, _ = users
    body = update("correct")
    assert admin.put(URL, json=body).status_code == 200
    body["revision"] = 1
    tile = body["workspace"]["layouts"][0]["desktop"][0]
    tile["w"] = -1
    assert admin.put(URL, json=body).status_code == 422
    tile["w"] = 6
    body["workspace"]["layouts"][0]["desktop"].append(tile.copy())
    assert admin.put(URL, json=body).status_code == 422
    assert admin.get(URL).json()["revision"] == 1
    with sqlite3.connect(workspace_layouts.DATABASE) as db:
        db.execute("UPDATE workspaces SET document=? WHERE account=?", ("{broken", "admin"))
    assert admin.get(URL).json() == {"revision": 1, "workspace": None, "damaged": True}
    assert admin.put(URL, json=update("Восстановлен", 1)).status_code == 200
