"""Optional bounded background weather polling with visible operational status.

A *running* FastAPI process is required. The worker is explicitly opt-in
via AGRORADAR_AUTO_MONITOR=1, so a contest demonstration cannot unexpectedly
consume 1000 external API calls for 500 fields. Never uses synthetic weather
to send real alerts. One instance only; multi-worker deployments need a queue.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/operations/monitor", tags=["Фоновый мониторинг"])

_STATUS_LOCK = threading.Lock()
_STATUS: dict = {
    "running": False,
    "last_started": None,
    "last_finished": None,
    "last_error": "",
    "processed_fields": 0,
    "degraded_fields": 0,
    "next_offset": 0,
}
_task: asyncio.Task | None = None


def status_snapshot() -> dict:
    with _STATUS_LOCK:
        status = dict(_STATUS)
    status.update({
        "enabled": os.getenv("AGRORADAR_AUTO_MONITOR", "0") == "1",
        "weather_configured": bool(os.getenv("OPENWEATHER_API_KEY", "").strip()),
        "mode": "bounded_single_process",
        "note": (
            "Автообновление работает только пока запущен сервер и включён "
            "AGRORADAR_AUTO_MONITOR=1. За проход опрашивается ограниченное число полей."
        ),
    })
    return status


@router.get("")
def read_monitor_status():
    return status_snapshot()


def attach_monitor(
    app,
    effective_fields: Callable[[], list[dict]],
    compose: Callable[[dict], Awaitable[dict]],
    capture: Callable[[list[dict]], object],
) -> None:
    """Bind a single bounded worker; no external traffic in test/import phase."""
    async def run_one_batch() -> dict:
        if not os.getenv("OPENWEATHER_API_KEY", "").strip():
            return {"processed": 0, "degraded": 0, "reason": "OpenWeather не настроен"}
        with _STATUS_LOCK:
            if _STATUS["running"]:
                return {"processed": 0, "degraded": 0, "reason": "Проверка уже выполняется"}
            _STATUS["running"] = True
            _STATUS["last_started"] = datetime.now(timezone.utc).isoformat()
            _STATUS["last_error"] = ""
        try:
            fields = effective_fields()
            if not fields:
                return {"processed": 0, "degraded": 0, "reason": "Нет полей"}
            try:
                size = min(50, max(1, int(os.getenv("AGRORADAR_MONITOR_BATCH", "20"))))
            except ValueError:
                size = 20
            with _STATUS_LOCK:
                start = _STATUS["next_offset"] % len(fields)
                _STATUS["next_offset"] = (start + size) % len(fields)
            selected = (fields + fields)[start:start + min(size, len(fields))]
            results = await asyncio.gather(*(compose(field) for field in selected))
            degraded = sum(item.get("forecast", {}).get("source") == "unavailable" for item in results)
            await asyncio.to_thread(capture, results)
            with _STATUS_LOCK:
                _STATUS["processed_fields"] += len(results)
                _STATUS["degraded_fields"] = degraded
            return {"processed": len(results), "degraded": degraded}
        except (Exception,) as exc:
            logger.warning("Background weather monitoring failed: %s", type(exc).__name__)
            with _STATUS_LOCK:
                _STATUS["last_error"] = f"Ошибка фоновой проверки: {type(exc).__name__}"
            return {"processed": 0, "degraded": 0, "reason": type(exc).__name__}
        finally:
            with _STATUS_LOCK:
                _STATUS["last_finished"] = datetime.now(timezone.utc).isoformat()
                _STATUS["running"] = False

    @router.post("/refresh", status_code=202)
    async def queue_refresh():
        global _task
        if not os.getenv("OPENWEATHER_API_KEY", "").strip():
            raise HTTPException(409, "Невозможно опросить поля: отсутствует ключ OpenWeather.")
        if _task is not None and not _task.done():
            return {"queued": False, "reason": "Предыдущая проверка ещё работает.", **status_snapshot()}
        _task = asyncio.create_task(run_one_batch(), name="agroradar-manual-monitor")
        return {"queued": True, **status_snapshot()}

    async def worker():
        while True:
            await asyncio.sleep(20)
            if os.getenv("OPENWEATHER_API_KEY", "").strip():
                await run_one_batch()
            try:
                interval = int(os.getenv("AGRORADAR_MONITOR_INTERVAL_SECONDS", "90"))
            except ValueError:
                interval = 90
            await asyncio.sleep(max(60, min(3600, interval)))

    background: dict[str, asyncio.Task | None] = {"task": None}
    async def on_startup():
        if os.getenv("AGRORADAR_AUTO_MONITOR", "0") == "1":
            background["task"] = asyncio.create_task(worker(), name="agroradar-weather-monitor")
    async def on_shutdown():
        if background["task"] is not None:
            background["task"].cancel()
            try:
                await background["task"]
            except asyncio.CancelledError:
                pass

    app.add_event_handler("startup", on_startup)
    app.add_event_handler("shutdown", on_shutdown)
