"""Automatic pre-change backups and secure administrator-only data export.

Never includes passwords, API secrets or hashed user credentials in a browser
download. Retains local snapshots of fields and account records for recovery.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import sqlite3
import tempfile
import time
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import Response

DATA_DIR = Path(os.getenv('AGRORADAR_DATA_DIR', str(Path(__file__).resolve().parents[1] / 'data')))
BACKUP_DIR = DATA_DIR / "backups"
MAX_BACKUPS_PER_FILE = 15
router = APIRouter(prefix="/api/admin", tags=["Резервные копии"])


def preserve_previous(path: Path) -> None:
    """Before replacing user-controlled JSON, archive current good bytes."""
    if not path.is_file():
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    archive_name = f"{path.name}.{time.time_ns()}.{uuid.uuid4().hex[:6]}.bak"
    destination = BACKUP_DIR / archive_name
    # O_EXCL prevents accidental overwrites even during rapid consecutive edits.
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "wb") as output, path.open("rb") as source:
            shutil.copyfileobj(source, output)
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    old = sorted(BACKUP_DIR.glob(f"{path.name}.*.bak"), key=lambda p: p.stat().st_mtime_ns, reverse=True)
    for obsolete in old[MAX_BACKUPS_PER_FILE:]:
        obsolete.unlink(missing_ok=True)


@router.get("/backup")
def download_backup(request: Request):
    """Download a portable snapshot WITHOUT secrets or viewer credentials.

    Safe for an admin to keep offline; still contains field polygons and notes,
    which should be handled as private operational data.
    """
    # The auth middleware enforces admin role for the entire /api/admin prefix.
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in ("fields.json", "field_geometries.json"):
            source = DATA_DIR / name
            if source.exists():
                bundle.write(source, arcname=f"data/{name}")
        monitoring = DATA_DIR / "monitoring.sqlite3"
        if monitoring.exists():
            # sqlite backup API creates transactionally consistent copy even
            # with other readers/writers; never copy a live -wal file blindly.
            with tempfile.TemporaryDirectory() as folder:
                copy = Path(folder) / "monitoring.sqlite3"
                original = sqlite3.connect(str(monitoring), timeout=10)
                target = sqlite3.connect(str(copy))
                try:
                    original.backup(target)
                finally:
                    target.close()
                    original.close()
                bundle.write(copy, arcname="data/monitoring.sqlite3")
        manifest = {
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "product": "AgroRadar AI",
            "included": ["fields.json", "field_geometries.json", "monitoring.sqlite3"],
            "excluded_secrets": ["admin_access.txt", "viewer_accounts.json", ".env", ".env.local"],
            "restoration": "Close backend, back up existing backend/data, copy files from data/ folder, then restart.",
            "notice": "Contains private field coordinates and agronomist observations. Keep this archive private.",
        }
        bundle.writestr("BACKUP_README.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return Response(
        content=payload.getvalue(), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="AgroRadar-backup-{stamp}.zip"',
                 "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.get("/system")
def system_info():
    return {"version": "3.5-final-candidate",
            "backup_count": len(list(BACKUP_DIR.glob("*.bak"))) if BACKUP_DIR.exists() else 0,
            "history_available": (DATA_DIR / "monitoring.sqlite3").exists(),
            "field_catalog_exists": (DATA_DIR / "fields.json").exists(),
            "note": "API-ключи, пароли и переменные окружения не возвращаются."}
