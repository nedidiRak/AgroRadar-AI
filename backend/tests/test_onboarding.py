import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app import auth, main, workspace_layouts

pytestmark = pytest.mark.real_auth
PATH = "/api/me/onboarding"


def login(username, password):
    client = TestClient(main.app)
    res = client.post("/api/auth/login", json={"username": username, "password": password})
    assert res.status_code == 200
    client.headers["X-Agro-CSRF"] = res.json()["csrf_token"]
    return client


@pytest.fixture
def accounts(tmp_path, monkeypatch):
    monkeypatch.setattr(workspace_layouts, "DATABASE", tmp_path / "settings.sqlite3")
    monkeypatch.setattr(auth, "USERS_FILE", tmp_path / "users.json")
    monkeypatch.setenv("AGRORADAR_ADMIN_PASSWORD", "onboarding-admin-example")
    admin = login("admin", "onboarding-admin-example")
    assert admin.post("/api/auth/users", json={"username": "trainee", "password": "sample-viewer-pass"}).status_code == 201
    return admin, login("trainee", "sample-viewer-pass")


def update(revision=0, step="choose-field", status="active"):
    return {"version": 1, "revision": revision, "step": step, "status": status}


def test_private_checkpoint_persists_and_recreated_account_starts_fresh(accounts):
    admin, viewer = accounts
    assert TestClient(main.app).get(PATH).status_code == 401
    assert admin.get(PATH).json()["role"] == "admin"
    assert viewer.get(PATH).json() == {**update(step="welcome", status="new"), "role": "viewer"}
    assert admin.put(PATH, json=update(step="catalog")).status_code == 200
    assert viewer.put(PATH, json=update(step="precipitation", status="paused")).status_code == 200
    assert login("trainee", "sample-viewer-pass").get(PATH).json()["step"] == "precipitation"
    assert admin.get(PATH).json()["step"] == "catalog"
    assert admin.delete("/api/auth/users/trainee").status_code == 200
    assert admin.post("/api/auth/users", json={"username": "trainee", "password": "different-password"}).status_code == 201
    assert login("trainee", "different-password").get(PATH).json()["revision"] == 0


def test_new_course_version_leaves_old_progress_archived(accounts):
    admin, _ = accounts
    assert admin.get(PATH).status_code == 200
    with sqlite3.connect(workspace_layouts.DATABASE) as db:
        db.execute("INSERT INTO onboarding VALUES ('admin','admin',0,8,'completed','finish')")
    assert admin.get(PATH).json()["status"] == "new"
    assert admin.put(PATH, json=update()).status_code == 200
    with sqlite3.connect(workspace_layouts.DATABASE) as db:
        assert db.execute("SELECT status FROM onboarding WHERE version=0").fetchone() == ("completed",)


def test_viewer_cannot_escalate_through_training(accounts):
    _, viewer = accounts
    for payload in [update(step="task"), update(step="studio"), update(step="made-up"),
                    {**update(), "role": "admin"}, {**update(), "account": "admin"},
                    {**update(), "version": 2}, update(status="completed")]:
        assert viewer.put(PATH, json=payload).status_code == 422
    assert viewer.put(PATH, headers={"X-Agro-CSRF": ""}, json=update()).status_code == 403
    assert viewer.post("/api/fields", json={}).status_code == 403
    assert viewer.get(PATH).json()["revision"] == 0


def test_concurrent_progress_and_explicit_reset(accounts):
    admin, _ = accounts
    with ThreadPoolExecutor(3) as pool:
        results = list(pool.map(lambda _: admin.put(PATH, json=update()).status_code, range(3)))
    assert sorted(results) == [200, 409, 409]
    assert admin.put(PATH, json=update(1, "finish", "completed")).json() == {"revision": 2}
    assert admin.put(PATH, json=update(2, "welcome", "new")).status_code == 200
    assert admin.get(PATH).json()["status"] == "new"
    assert admin.get("/api/me/layouts").json() == {"revision": 0, "workspace": None}
