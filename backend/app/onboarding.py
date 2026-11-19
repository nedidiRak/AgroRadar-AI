"""Personal course checkpoints. Farm records and dashboard layouts have separate tables."""
from contextlib import closing
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from . import workspace_layouts

router = APIRouter(prefix="/api/me", tags=["Обучение"])
VERSION = 1
COMMON = {"welcome", "choose-field", "weather", "alerts", "risk", "question", "interpret", "finish"}
ADMIN = COMMON | {"overview", "boundary", "journal", "task", "task-form", "studio", "catalog",
                  "add-widget", "move-widget", "resize-widget", "save-layout"}


class Checkpoint(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")
    version: Literal[1]
    revision: int = Field(ge=0)
    status: Literal["new", "active", "paused", "declined", "completed"]
    step: str = Field(min_length=1, max_length=32)


def connect():
    db = workspace_layouts.connect()
    db.execute("""CREATE TABLE IF NOT EXISTS onboarding (
        account TEXT NOT NULL, role TEXT NOT NULL, version INTEGER NOT NULL, revision INTEGER NOT NULL,
        status TEXT NOT NULL, step TEXT NOT NULL, PRIMARY KEY(account, role, version))""")
    return db


def identity(request: Request):
    user = request.state.agro_user
    return user["account_id"], user["role"], VERSION


@router.get("/onboarding")
def read_checkpoint(request: Request):
    key = identity(request)
    with closing(connect()) as db:
        row = db.execute("SELECT revision, status, step FROM onboarding WHERE account=? AND role=? AND version=?", key).fetchone()
    revision, status, step = row or (0, "new", "welcome")
    return {"role": key[1], "version": VERSION, "revision": revision, "status": status, "step": step}


@router.put("/onboarding")
def save_checkpoint(payload: Checkpoint, request: Request):
    key = identity(request)
    steps = ADMIN if key[1] == "admin" else COMMON
    if (payload.step not in steps or (payload.status == "completed" and payload.step != "finish")
            or (payload.status == "new" and payload.step != "welcome")):
        raise HTTPException(422, "Этот этап недоступен в текущем маршруте.")
    with closing(connect()) as db, db:
        if payload.revision == 0:
            result = db.execute("""INSERT INTO onboarding (account, role, version, revision, status, step)
                VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT DO NOTHING""", (*key, payload.status, payload.step))
        else:
            result = db.execute("""UPDATE onboarding SET revision=revision+1, status=?, step=?
                WHERE account=? AND role=? AND version=? AND revision=?""",
                                (payload.status, payload.step, *key, payload.revision))
        if result.rowcount != 1:
            raise HTTPException(409, "Другой сеанс уже обновил прогресс.")
    return {"revision": payload.revision + 1}
