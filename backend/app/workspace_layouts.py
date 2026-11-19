"""Versioned presentation settings, isolated from farm and monitoring data."""
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

router = APIRouter(prefix="/api/me", tags=["Персональный интерфейс"])
DATABASE = Path(os.getenv("AGRORADAR_DATA_DIR", Path(__file__).resolve().parents[1] / "data")) / "ui_layouts.sqlite3"
Identifier = Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")]


class LayoutModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Widget(LayoutModel):
    id: Identifier
    type: Identifier
    x: int = Field(ge=0, le=11)
    y: int = Field(ge=0, le=100000)
    w: int = Field(ge=1, le=12)
    h: int | None = Field(ge=1, le=200)
    hidden: bool = False
    fieldId: int | None = Field(default=None, gt=0)


Widgets = Annotated[list[Widget], Field(max_length=64)]


class Layout(LayoutModel):
    id: Identifier
    name: str = Field(min_length=1, max_length=64)
    desktop: Widgets | None
    mobile: Widgets | None

    @model_validator(mode="after")
    def valid_widgets(self):
        for items in (self.desktop, self.mobile):
            if items and len({widget.id for widget in items}) != len(items):
                raise ValueError("Повторяющийся идентификатор виджета")
        if not self.name.strip():
            raise ValueError("Укажи название макета")
        return self


class Workspace(LayoutModel):
    version: Literal[1]
    active: Identifier
    layouts: list[Layout] = Field(min_length=1, max_length=24)

    @model_validator(mode="after")
    def valid_layouts(self):
        ids = {layout.id for layout in self.layouts}
        if self.active not in ids or len(ids) != len(self.layouts):
            raise ValueError("Некорректный список макетов")
        return self


class Update(LayoutModel):
    revision: int = Field(ge=0)
    workspace: Workspace


def connect():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATABASE, timeout=10)
    db.execute("CREATE TABLE IF NOT EXISTS workspaces (account TEXT PRIMARY KEY, revision INTEGER NOT NULL, document TEXT NOT NULL)")
    return db


@router.get("/layouts")
def read_layouts(request: Request):
    with closing(connect()) as db:
        row = db.execute("SELECT revision, document FROM workspaces WHERE account=?",
                         (request.state.agro_user["account_id"],)).fetchone()
    if not row:
        return {"revision": 0, "workspace": None}
    try:
        document = json.loads(row[1])
    except (ValueError, TypeError):
        # Report the revision so the owner can explicitly restore factory settings.
        return {"revision": row[0], "workspace": None, "damaged": True}
    return {"revision": row[0], "workspace": document}


@router.put("/layouts")
def write_layouts(payload: Update, request: Request):
    account = request.state.agro_user["account_id"]
    document = payload.workspace.model_dump_json()
    with closing(connect()) as db, db:
        if payload.revision == 0:
            result = db.execute("INSERT INTO workspaces VALUES (?, 1, ?) ON CONFLICT(account) DO NOTHING",
                                (account, document))
        else:
            result = db.execute("UPDATE workspaces SET revision=revision+1, document=? WHERE account=? AND revision=?",
                                (document, account, payload.revision))
        if result.rowcount != 1:
            raise HTTPException(409, "Макет уже изменён в другом окне. Загрузи актуальную версию.")
    return {"revision": payload.revision + 1}
