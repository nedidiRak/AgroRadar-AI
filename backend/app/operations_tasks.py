"""AgroRadar 4: auditable follow-up actions after a weather alert.

Create/advance/complete field inspections. A completed human task does NOT
clear a meteorological alert; actual weather governs alert resolution.
Viewer access remains read-only via the existing FastAPI auth middleware.
"""
from __future__ import annotations

import sqlite3
import threading
from datetime import date
from collections.abc import Callable
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field

from .monitoring import connection, record_event, timestamp

router = APIRouter(prefix="/api/operations/tasks", tags=["Действия агронома"])
_LOCK = threading.RLock()


class TaskCreate(BaseModel):
    field_id: int = Field(gt=0)
    title: str = Field(min_length=4, max_length=160)
    action: str = Field(min_length=5, max_length=1200)
    assigned_to: str = Field(default="", max_length=80)
    due_date: str | None = None
    alert_id: int | None = Field(default=None, gt=0)


class TaskUpdate(BaseModel):
    status: str
    completion_note: str = Field(default="", max_length=1000)


def ensure_tasks(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS field_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            title TEXT NOT NULL,
            action TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'planned',
            assigned_to TEXT NOT NULL DEFAULT '',
            due_date TEXT,
            alert_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            completed_at TEXT,
            completion_note TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_field_status
        ON field_tasks(field_id,status,id DESC);
    """)


def _actor(request: Request) -> str:
    return str(getattr(request.state, "agro_user", {}).get("username", "system"))[:60]


def _iso_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "Дата выполнения должна быть YYYY-MM-DD.") from exc


@router.get("")
def list_tasks(field_id: int | None = None, limit: int = 200):
    if not 1 <= limit <= 500:
        raise HTTPException(422, "Лимит 1–500.")
    if field_id is not None and field_id <= 0:
        raise HTTPException(422, "Некорректный идентификатор поля.")
    with _LOCK, connection() as conn:
        ensure_tasks(conn)
        if field_id is None:
            rows = conn.execute("""
                SELECT * FROM field_tasks
                ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
                         id DESC LIMIT ?""", (limit,)).fetchall()
        else:
            rows = conn.execute("""
                SELECT * FROM field_tasks WHERE field_id=?
                ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
                         id DESC LIMIT ?""", (field_id, limit)).fetchall()
    return {"tasks": [dict(row) for row in rows]}


def build_tasks_router(find_field: Callable[[int], dict]) -> APIRouter:
    # Attach POST route after injection of the field validator.
    # GET /api/operations/tasks is registered on the common router above.
    @router.post("", status_code=status.HTTP_201_CREATED)
    def create_task(payload: TaskCreate, request: Request):
        field = find_field(payload.field_id)
        title, action = payload.title.strip(), payload.action.strip()
        if len(title) < 4 or len(action) < 5:
            raise HTTPException(422, "Заполни название и действие.")
        due = _iso_date(payload.due_date)
        if payload.alert_id is not None:
            with _LOCK, connection() as conn:
                matching = conn.execute(
                    "SELECT field_id FROM alerts WHERE id=?", (payload.alert_id,),
                ).fetchone()
                if not matching or matching["field_id"] != payload.field_id:
                    raise HTTPException(422, "Предупреждение не относится к выбранному полю.")
        now = timestamp()
        with _LOCK, connection() as conn:
            ensure_tasks(conn)
            cursor = conn.execute("""
                INSERT INTO field_tasks
                 (field_id,field_name,title,action,status,assigned_to,due_date,alert_id,
                  created_at,updated_at,created_by)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (field["id"], field["name"], title, action, "planned",
                 payload.assigned_to.strip(), due, payload.alert_id,
                 now, now, _actor(request)),
            )
            result = conn.execute("SELECT * FROM field_tasks WHERE id=?", (cursor.lastrowid,)).fetchone()
        record_event(_actor(request), "task_created", payload.field_id, f"task_id={result['id']}")
        return {"created": True, "task": dict(result)}

    @router.put("/{task_id}")
    def update_task(task_id: int, payload: TaskUpdate, request: Request):
        if payload.status not in ("planned", "in_progress", "done"):
            raise HTTPException(422, "Допустимые статусы: planned, in_progress, done.")
        note = payload.completion_note.strip()
        if payload.status == "done" and not note:
            raise HTTPException(422, "Укажи результат выполненной проверки.")
        with _LOCK, connection() as conn:
            ensure_tasks(conn)
            old = conn.execute("SELECT * FROM field_tasks WHERE id=?", (task_id,)).fetchone()
            if old is None:
                raise HTTPException(404, "Задание не найдено.")
            if old["status"] == "done" and payload.status == "planned":
                raise HTTPException(409, "Завершённое задание можно вернуть в работу, но не удалить его историю.")
            now = timestamp()
            conn.execute("""
                UPDATE field_tasks SET status=?,updated_at=?,completion_note=?,
                    completed_at=? WHERE id=?""",
                (payload.status, now, note if payload.status=="done" else old["completion_note"],
                 now if payload.status=="done" else None, task_id),
            )
            result = conn.execute("SELECT * FROM field_tasks WHERE id=?", (task_id,)).fetchone()
        record_event(_actor(request), "task_" + payload.status, result["field_id"],
                     f"task_id={task_id}")
        return {"saved": True, "task": dict(result)}

    return router
