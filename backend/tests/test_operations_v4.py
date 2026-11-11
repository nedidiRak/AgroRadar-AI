"""Version 4.0 action lifecycle and RBAC, isolated from real user data."""
from __future__ import annotations

import json
import pytest
from fastapi.testclient import TestClient

from app import auth, backups, main, monitoring


@pytest.fixture
def sandbox(monkeypatch,tmp_path):
    monkeypatch.setattr(main,"CATALOG_FILE",tmp_path/"fields.json")
    monkeypatch.setattr(main,"GEOMETRY_FILE",tmp_path/"geometries.json")
    monkeypatch.setattr(monitoring,"DATABASE_FILE",tmp_path/"monitoring.sqlite3")
    monkeypatch.setattr(backups,"BACKUP_DIR",tmp_path/"backups")
    monkeypatch.delenv("OPENWEATHER_API_KEY",raising=False)
    monkeypatch.delenv("AGRORADAR_AUTO_MONITOR",raising=False)
    return TestClient(main.app)


def test_task_workflow_requires_real_completion_result(sandbox):
    client=sandbox
    new=client.post("/api/operations/tasks",json={
        "field_id":1,"title":"Осмотреть листья","action":"Проверить наличие признаков ржавчины.",
        "assigned_to":"Агроном","due_date":"2026-11-19",
    })
    assert new.status_code==201,new.text
    item=new.json()["task"]
    assert item["status"]=="planned"
    task_id=item["id"]
    before=client.get("/api/operations/tasks")
    assert before.status_code==200
    assert len(before.json()["tasks"])==1
    assert client.put(f"/api/operations/tasks/{task_id}",
                      json={"status":"done","completion_note":""}).status_code==422
    assert client.put(f"/api/operations/tasks/{task_id}",
                      json={"status":"in_progress"}).json()["task"]["status"]=="in_progress"
    final=client.put(f"/api/operations/tasks/{task_id}",json={
        "status":"done","completion_note":"Осмотрено 15 растений, визуальных признаков не найдено.",
    })
    assert final.status_code==200,final.text
    assert final.json()["task"]["completed_at"]
    assert final.json()["task"]["completion_note"].startswith("Осмотрено")
    assert client.put(f"/api/operations/tasks/{task_id}",json={
        "status":"planned"}).status_code==409
    assert client.get("/api/operations/tasks?field_id=999").json()["tasks"]==[]
    assert client.get("/api/operations/tasks?field_id=1").json()["tasks"][0]["status"]=="done"
    activity=client.get("/api/operations/activity").json()["events"]
    assert {"task_created","task_in_progress","task_done"} <= {e["action"] for e in activity}
    assert monitoring.DATABASE_FILE.exists()


def test_invalid_task_reference_and_input_rejected(sandbox):
    client=sandbox
    assert client.post("/api/operations/tasks",json={
        "field_id":999,"title":"Осмотреть листья","action":"Проверить состояние"
    }).status_code==404
    assert client.post("/api/operations/tasks",json={
        "field_id":1,"title":"Осмотреть листья","action":"Проверить состояние",
        "due_date":"99.99.99"
    }).status_code==422
    assert client.post("/api/operations/tasks",json={
        "field_id":1,"title":"Осмотреть листья","action":"Проверить состояние",
        "alert_id":123456
    }).status_code==422
    assert client.get("/api/operations/tasks?limit=9999").status_code==422
    assert client.get("/api/operations/monitor").status_code==200
    assert client.post("/api/operations/monitor/refresh").status_code==409


@pytest.mark.real_auth
def test_viewer_can_read_tasks_but_cannot_create_or_finish(monkeypatch,tmp_path):
    monkeypatch.setattr(main,"CATALOG_FILE",tmp_path/"fields.json")
    monkeypatch.setattr(main,"GEOMETRY_FILE",tmp_path/"geometries.json")
    monkeypatch.setattr(monitoring,"DATABASE_FILE",tmp_path/"monitoring.sqlite3")
    monkeypatch.setattr(backups,"BACKUP_DIR",tmp_path/"backups")
    monkeypatch.setattr(auth,"PASSWORD_FILE",tmp_path/"admin_password.txt")
    monkeypatch.setattr(auth,"USERS_FILE",tmp_path/"viewers.json")
    monkeypatch.delenv("AGRORADAR_ADMIN_PASSWORD",raising=False)
    monkeypatch.delenv("OPENWEATHER_API_KEY",raising=False)
    auth._SESSIONS.clear()
    auth._FAILED_LOGINS.clear()
    admin=TestClient(main.app)
    login=admin.post("/api/auth/login",json={"username":"admin","password":auth.admin_password()})
    assert login.status_code==200,login.text
    csrf={"X-Agro-CSRF":login.json()["csrf_token"]}
    created=admin.post("/api/auth/users",headers=csrf,
                       json={"username":"judge04","password":"non-shared-demo-password"})
    assert created.status_code==201,created.text
    task=admin.post("/api/operations/tasks",headers=csrf,json={
        "field_id":1,"title":"Осмотр номер 1","action":"Сверить прогноз и наблюдения.",
    })
    assert task.status_code==201
    task_id=task.json()["task"]["id"]
    viewer=TestClient(main.app)
    as_viewer=viewer.post("/api/auth/login",json={
        "username":"judge04","password":"non-shared-demo-password",
    })
    assert as_viewer.status_code==200
    viewer_csrf={"X-Agro-CSRF":as_viewer.json()["csrf_token"]}
    assert viewer.get("/api/operations/tasks").status_code==200
    assert viewer.get("/api/operations/monitor").status_code==200
    assert viewer.post("/api/operations/tasks",headers=viewer_csrf,json={
        "field_id":1,"title":"Нельзя создать","action":"Проверить участок",
    }).status_code==403
    assert viewer.put(f"/api/operations/tasks/{task_id}",headers=viewer_csrf,json={
        "status":"done","completion_note":"Нельзя изменять",
    }).status_code==403
    assert viewer.post("/api/operations/monitor/refresh",headers=viewer_csrf).status_code==403
