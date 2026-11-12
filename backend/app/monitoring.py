"""Persistent field risk history, operational alerts and auditable changes.

SQLite is an additive local sidecar. Existing fields.json, saved polygons, login
passwords and the user's API configuration are NEVER migrated or replaced here.
Demo weather is historical demonstration data, never a real operational alert.
"""
from __future__ import annotations

import json
import os
from contextlib import contextmanager
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Literal

DATA_DIR = Path(os.getenv('AGRORADAR_DATA_DIR', str(Path(__file__).resolve().parents[1] / 'data')))
DATABASE_FILE = DATA_DIR / 'monitoring.sqlite3'
_LOCK = threading.RLock()
MAX_FIELD_SNAPSHOTS = 240
router = APIRouter(prefix="/api/operations", tags=["История и предупреждения"])


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connection():
    DATABASE_FILE.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DATABASE_FILE), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            created_epoch INTEGER NOT NULL,
            level TEXT NOT NULL,
            source TEXT NOT NULL,
            min_temperature_c REAL,
            current_temperature_c REAL,
            known_factors INTEGER NOT NULL DEFAULT 0,
            unknown_factors INTEGER NOT NULL DEFAULT 4,
            fingerprint TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_field_time
            ON snapshots(field_id, id DESC);
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            field_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            factor TEXT NOT NULL,
            title TEXT NOT NULL,
            severity TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            reason TEXT NOT NULL,
            action TEXT NOT NULL,
            source TEXT NOT NULL,
            first_seen TEXT NOT NULL,
            last_seen TEXT NOT NULL,
            acknowledged_by TEXT,
            acknowledged_at TEXT,
            UNIQUE(field_id, factor)
        );
        CREATE INDEX IF NOT EXISTS idx_alert_status ON alerts(status, severity);
        CREATE TABLE IF NOT EXISTS activity (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            username TEXT NOT NULL,
            action TEXT NOT NULL,
            field_id INTEGER,
            details TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(id DESC);
    """)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _row(item: sqlite3.Row) -> dict:
    return dict(item)


def _compact_field(field: dict) -> dict:
    weather = field.get("weather") or {}
    forecast = field.get("forecast") or {}
    analysis = field.get("risk_analysis") or {}
    risk = field.get("risk") or {}
    quality = analysis.get("data_quality") or {}
    return {
        "field_id": field["id"],
        "level": risk.get("level", "unknown"),
        "source": forecast.get("source", "unavailable"),
        "min_temperature_c": forecast.get("min_temperature_next_24h_c"),
        "current_temperature_c": weather.get("temperature_c"),
        "known_factors": int(analysis.get("known_count", quality.get("known_factors", 0))),
        "unknown_factors": int(analysis.get("unknown_count", quality.get("unknown_factors", 4))),
    }


def capture_dashboard(fields: list[dict]) -> dict:
    """Capture idempotent snapshots and update actionable LIVE alerts.

    Called after a successful dashboard response. Demo/simulation are stored with
    explicit provenance but DO NOT create operational alerts.
    """
    from hashlib import sha256

    recorded = 0
    now = timestamp()
    epoch = int(time.time())
    with _LOCK:
        with connection() as conn:
            for field in fields:
                item = _compact_field(field)
                signature = sha256(json.dumps(item, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                previous = conn.execute(
                    "SELECT fingerprint, created_epoch FROM snapshots WHERE field_id=? ORDER BY id DESC LIMIT 1",
                    (field["id"],),
                ).fetchone()
                if not previous or signature != previous["fingerprint"] or epoch - previous["created_epoch"] >= 1800:
                    conn.execute(
                        """INSERT INTO snapshots
                        (field_id,created_at,created_epoch,level,source,min_temperature_c,
                         current_temperature_c,known_factors,unknown_factors,fingerprint)
                         VALUES (?,?,?,?,?,?,?,?,?,?)""",
                        (field["id"], now, epoch, item["level"], item["source"],
                         item["min_temperature_c"], item["current_temperature_c"],
                         item["known_factors"], item["unknown_factors"], signature),
                    )
                    recorded += 1
                    conn.execute(
                        """DELETE FROM snapshots WHERE field_id=? AND id NOT IN
                           (SELECT id FROM snapshots WHERE field_id=? ORDER BY id DESC LIMIT ?)""",
                        (field["id"], field["id"], MAX_FIELD_SNAPSHOTS),
                    )
                if item["source"] not in ("openweather_forecast_3h",):
                    continue
                active = set()
                for risk in (field.get("risk_analysis") or {}).get("assessments", []):
                    if risk.get("level") not in ("high", "medium"):
                        continue
                    factor = risk["id"]
                    active.add(factor)
                    old = conn.execute(
                        "SELECT severity,status FROM alerts WHERE field_id=? AND factor=?",
                        (field["id"], factor),
                    ).fetchone()
                    new_status = ("open" if old is None or old["status"] == "resolved"
                                  or old["severity"] == "medium" and risk["level"] == "high"
                                  else old["status"])
                    conn.execute(
                        """INSERT INTO alerts(field_id,field_name,factor,title,severity,status,
                           reason,action,source,first_seen,last_seen)
                           VALUES(?,?,?,?,?,?,?,?,?,?,?)
                           ON CONFLICT(field_id,factor) DO UPDATE SET
                           field_name=excluded.field_name,title=excluded.title,
                           severity=excluded.severity,status=excluded.status,
                           reason=excluded.reason,action=excluded.action,
                           source=excluded.source,last_seen=excluded.last_seen,
                           acknowledged_at=CASE WHEN excluded.status='open' THEN NULL
                                                ELSE alerts.acknowledged_at END,
                           acknowledged_by=CASE WHEN excluded.status='open' THEN NULL
                                                ELSE alerts.acknowledged_by END""",
                        (field["id"], field["name"], factor, risk["title"], risk["level"],
                         new_status, risk["reason"], risk["next_step"],
                         item["source"], now, now),
                    )
                # Resolve only on verified LIVE data, not on outage or demo.
                if item["unknown_factors"] == 0:
                    if active:
                        placeholders = ",".join("?" for _ in active)
                        conn.execute(
                            f"UPDATE alerts SET status='resolved',last_seen=? WHERE field_id=? AND factor NOT IN ({placeholders}) AND status!='resolved'",
                            (now, field["id"], *sorted(active)),
                        )
                    else:
                        conn.execute(
                            "UPDATE alerts SET status='resolved',last_seen=? WHERE field_id=? AND status!='resolved'",
                            (now, field["id"]),
                        )
    return {"snapshots_added": recorded}


def record_event(username: str, action: str, field_id: int | None = None, details: str = "") -> None:
    with _LOCK:
        with connection() as conn:
            conn.execute(
                "INSERT INTO activity(created_at,username,action,field_id,details) VALUES(?,?,?,?,?)",
                (timestamp(), username[:60], action[:80], field_id, details[:500]),
            )
            conn.execute(
                "DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT 3000)"
            )


@router.get("/summary")
def summary():
    with _LOCK:
        with connection() as conn:
            latest = conn.execute("SELECT COUNT(DISTINCT field_id) AS total FROM snapshots").fetchone()["total"]
            states = conn.execute(
                "SELECT status, COUNT(*) AS count FROM alerts GROUP BY status"
            ).fetchall()
            activity_count = conn.execute("SELECT COUNT(*) AS total FROM activity").fetchone()["total"]
    counts = {row["status"]: row["count"] for row in states}
    return {"monitored_fields": latest, "open_alerts": counts.get("open", 0),
            "acknowledged_alerts": counts.get("acknowledged", 0),
            "resolved_alerts": counts.get("resolved", 0),
            "activity_count": activity_count}


@router.get("/fields/{field_id}/history")
def field_history(field_id: int, limit: int = 60):
    if not 1 <= limit <= 240:
        raise HTTPException(422, "Лимит истории должен быть от 1 до 240.")
    with _LOCK:
        with connection() as conn:
            rows = conn.execute(
                """SELECT id,created_at,level,source,min_temperature_c,
                   current_temperature_c,known_factors,unknown_factors
                   FROM snapshots WHERE field_id=? ORDER BY id DESC LIMIT ?""",
                (field_id, limit),
            ).fetchall()
    return {"field_id": field_id, "snapshots": list(reversed([_row(row) for row in rows])),
            "notice": "История сохраняется при открытии сводки; данные demo помечены как демонстрационные."}


@router.get("/alerts")
def list_alerts(status: Literal["open", "acknowledged", "resolved", "all"] = "all", limit: int = 100):
    if not 1 <= limit <= 300:
        raise HTTPException(422, "Лимит от 1 до 300.")
    with _LOCK:
        with connection() as conn:
            if status == "all":
                rows = conn.execute(
                    """SELECT * FROM alerts ORDER BY
                    CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
                    CASE severity WHEN 'high' THEN 0 ELSE 1 END, id DESC LIMIT ?""",
                    (limit,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """SELECT * FROM alerts WHERE status=?
                    ORDER BY CASE severity WHEN 'high' THEN 0 ELSE 1 END, id DESC LIMIT ?""",
                    (status, limit),
                ).fetchall()
    return {"alerts": [_row(row) for row in rows], "status": status,
            "note": "Оповещения создаются только по живому прогнозу OpenWeather, не по демо."}


class AlertUpdate(BaseModel):
    status: Literal["acknowledged", "open"]


@router.put("/alerts/{alert_id}")
def set_alert_status(alert_id: int, payload: AlertUpdate, request: Request):
    username = getattr(request.state, "agro_user", {}).get("username", "admin")
    with _LOCK:
        with connection() as conn:
            found = conn.execute("SELECT id,status FROM alerts WHERE id=?", (alert_id,)).fetchone()
            if not found:
                raise HTTPException(404, "Оповещение не найдено.")
            if found["status"] == "resolved" and payload.status == "acknowledged":
                raise HTTPException(409, "Оповещение уже закрыто: нельзя подтвердить неактуальный риск.")
            conn.execute(
                "UPDATE alerts SET status=?,acknowledged_by=?,acknowledged_at=? WHERE id=?",
                (payload.status, username if payload.status == "acknowledged" else None,
                 timestamp() if payload.status == "acknowledged" else None, alert_id),
            )
    record_event(username, "alert_" + payload.status, details=f"alert_id={alert_id}")
    return {"saved": True, "alert_id": alert_id, "status": payload.status}


@router.get("/activity")
def activity(limit: int = 50):
    if not 1 <= limit <= 200:
        raise HTTPException(422, "Лимит от 1 до 200.")
    with _LOCK:
        with connection() as conn:
            rows = conn.execute("SELECT id,created_at,username,action,field_id,details FROM activity ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return {"events": [_row(row) for row in rows]}
