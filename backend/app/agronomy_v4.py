"""AgroRadar 4.0: evidence-labelled agronomic screening and 7-day water context.

A weather-based SCREENING result is not a diagnosis, irrigation order or
yield-loss estimate. Leaf wetness/inoculum and root-zone moisture are unknown.
Sources:
- https://extension.uga.edu/publications/detail.html?number=C1060
- https://www.ars.usda.gov/midwest-area/stpaul/cereal-disease-lab/docs/cereal-rusts/wheat-leaf-rust/
- https://open-meteo.com/en/docs (reference ET0 according to FAO-56).
"""
from __future__ import annotations

import math
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

LEAF_RUST_SOURCES = [
    {"title": "UGA Extension — Leaf Rust of Wheat",
     "url": "https://extension.uga.edu/publications/detail.html?number=C1060"},
    {"title": "USDA ARS — Wheat Leaf Rust",
     "url": "https://www.ars.usda.gov/midwest-area/stpaul/cereal-disease-lab/docs/cereal-rusts/wheat-leaf-rust/"},
]
WATER_SOURCES = [
    {"title": "Open-Meteo — Reference ET₀ and precipitation",
     "url": "https://open-meteo.com/en/docs"},
    {"title": "FAO-56 — Crop evapotranspiration",
     "url": "https://www.fao.org/4/x0490e/x0490e00.htm"},
]
WATER_CACHE_TTL = 6 * 3600
_CACHE_LOCK = threading.Lock()
_WATER_CACHE: dict[tuple[float, float], tuple[float, dict]] = {}


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def wheat_rust_screen(field: dict, forecast: dict) -> dict:
    """Flag weather conducive to scouting *wheat* leaf rust; not infection.

    UGA/USDA: about 15-25 °C with moisture/wet leaves is favorable.
    RH >= 90%, rain > 0 and 2 consecutive forecast time points are explicitly
    *engineering proxies*, not thresholds validated to predict infection.
    """
    crop = str(field.get("crop") or "").casefold()
    base = {
        "id": "wheat_leaf_rust_weather",
        "title": "Условия для наблюдения бурой ржавчины пшеницы",
        "source": str(forecast.get("source", "unavailable")),
        "sources": LEAF_RUST_SOURCES,
        "limitations": [
            "Дождь и влажность воздуха не подтверждают влагу на листьях.",
            "Нет измерений смачивания листа, наличия спор, устойчивости сорта и полевого осмотра.",
            "Это погодный повод для обследования, а не вероятность заболевания, диагноз или рекомендация обработки.",
        ],
        "action": "При признаках подходящей влажной погоды осмотреть листья пшеницы и зафиксировать симптомы; решение принимает агроном.",
        "units": "3-часовые интервалы прогноза",
        "matched_intervals": 0,
        "temperature_range_c": [15, 25],
        "humidity_proxy_min_pct": 90,
        "status": "unknown",
        "label": "Недостаточно данных",
        "explanation": "",
    }
    if not ("пшениц" in crop or "wheat" in crop):
        return {**base, "status": "not_applicable", "label": "Не применяется",
                "explanation": "Проверка предназначена только для пшеницы."}
    points = forecast.get("points")
    if not isinstance(points, list) or not points:
        return {**base, "explanation": "Нет прогноза температуры, осадков и влажности по времени."}
    run = 0
    matches = 0
    valid = 0
    missing = 0
    for point in points:
        if not isinstance(point, dict):
            missing += 1
            run = 0
            continue
        temp = _number(point.get("temperature_c"))
        humidity = _number(point.get("humidity_pct"))
        rain = _number(point.get("rain_mm_3h"))
        if any(item is None for item in (temp, humidity, rain)):
            missing += 1
            run = 0
            continue
        valid += 1
        wet_proxy = rain > 0 and humidity >= 90
        favorable = 15 <= temp <= 25 and wet_proxy
        run = (run + 1) if favorable else 0
        matches = max(matches, run)
    if valid == 0:
        return {**base, "explanation": "Не хватает погодных переменных для оценки условий по интервалам."}
    if matches >= 2:
        return {
            **base, "status": "watch", "label": "Стоит проверить поле",
            "matched_intervals": matches,
            "explanation": (
                f"В прогнозе {matches} последовательных 3-часовых интервалов "
                "температура 15–25 °C, влажность не ниже 90% и есть осадки. "
                "Для бурой ржавчины благоприятны тепло и влага по UGA/USDA; "
                "использованные здесь погодные пороги — приближение, без измерения влаги на листьях."
            ),
        }
    return {
        **base, "status": "no_signal" if missing == 0 else "partial",
        "label": "По доступным интервалам сигнала нет" if missing == 0 else "Неполный прогноз",
        "matched_intervals": matches,
        "explanation": (
            "Сочетание погодных условий для дополнительной проверки не обнаружено "
            f"в {valid} доступных интервалах. Интервалов с недостающими данными: {missing}. "
            "Это не подтверждает отсутствие инфекции или риска болезни."
        ),
    }


def water_balance_7d(payload: dict) -> dict:
    """Reference atmospheric P - ET0, NOT root-zone soil water or irrigation need."""
    base = {
        "status": "unavailable", "label": "Исторические данные недоступны",
        "source": "open_meteo_daily", "sources": WATER_SOURCES,
        "precipitation_7d_mm": None, "et0_7d_mm": None, "p_minus_et0_mm": None,
        "days": 0, "period_start": None, "period_end": None,
        "limitation": (
            "P − ET₀ отражает баланс осадков и эталонной испаряемости, "
            "но не запасы воды в почве, водный стресс культуры, коэффициент Kc или норму полива. "
            "Для решения нужны почвенная влажность, стадия развития и осмотр участка."
        ),
    }
    if payload.get("status") == "disabled":
        return {**base, "status": "disabled", "label": "Отключено оператором",
                "explanation": "Для включения истории осадков задай AGRORADAR_WATER_CONTEXT=1."}
    if payload.get("status") == "unavailable":
        return {**base, "explanation": payload.get("reason", "Источник временно недоступен.")}
    daily = payload.get("daily")
    if not isinstance(daily, dict):
        return {**base, "explanation": "Поставщик не передал суточные ряды."}
    dates = daily.get("time")
    precip = daily.get("precipitation_sum")
    et0 = daily.get("et0_fao_evapotranspiration")
    if not all(isinstance(seq, list) for seq in (dates, precip, et0)):
        return {**base, "explanation": "Неверный формат суточных рядов."}
    today = datetime.now(timezone.utc).date()
    expected = [(today - timedelta(days=offset)).isoformat() for offset in range(7, 0, -1)]
    available = {}
    for day, p, e in zip(dates, precip, et0):
        if not isinstance(day, str) or day not in expected:
            continue  # no future/today or out-of-window history
        p, e = _number(p), _number(e)
        if p is not None and e is not None and p >= 0 and e >= 0:
            available[day] = (day, p, e)
    rows = [available[day] for day in expected if day in available]
    # Missing yesterday is missing even if older extra days exist.
    if len(rows) != 7:
        return {**base, "status": "partial", "label": "Неполная история",
                "days": len(rows),
                "explanation": "Не хватает семи полностью завершённых дней осадков и ET₀."}
    p_total = round(sum(row[1] for row in rows), 2)
    e_total = round(sum(row[2] for row in rows), 2)
    balance = round(p_total - e_total, 2)
    return {
        **base, "status": "available", "label": "Оценка атмосферного водного баланса",
        "days": len(rows), "period_start": rows[0][0], "period_end": rows[-1][0],
        "precipitation_7d_mm": p_total, "et0_7d_mm": e_total,
        "p_minus_et0_mm": balance,
        "explanation": (
            f"За последние 7 полных дней: осадки {p_total:g} мм, "
            f"эталонная испаряемость ET₀ {e_total:g} мм, P − ET₀ = {balance:g} мм. "
            "Отрицательное число показывает превышение эталонного испарительного спроса над осадками, "
            "но не доказывает засуху или дефицит воды в корнеобитаемом слое."
        ),
    }


async def fetch_water_history(field: dict) -> dict:
    """Opt-in remote context with 6-hour cache. Only for selected field.

    Not called in /api/dashboard: hundreds of fields must never trigger
    hundreds of Open-Meteo calls. Local demo use is non-commercial;
    commercial use of the provider requires a separate plan/license.
    """
    if os.getenv("AGRORADAR_WATER_CONTEXT", "1").strip() != "1":
        return {"status": "disabled"}
    lat = _number(field.get("lat"))
    lon = _number(field.get("lon"))
    if lat is None or lon is None or not -90 <= lat <= 90 or not -180 <= lon <= 180:
        return {"status": "unavailable", "reason": "Неверные координаты поля."}
    key = (round(lat, 3), round(lon, 3))
    with _CACHE_LOCK:
        previous = _WATER_CACHE.get(key)
        if previous and previous[0] > time.monotonic():
            return previous[1]
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(9.0, connect=4.0)) as client:
            response = await client.get("https://api.open-meteo.com/v1/forecast", params={
                "latitude": lat, "longitude": lon,
                "daily": "precipitation_sum,et0_fao_evapotranspiration",
                "past_days": 8, "forecast_days": 1, "timezone": "UTC",
            })
            response.raise_for_status()
            raw = response.json()
            if not isinstance(raw, dict):
                raise ValueError("invalid weather data")
            payload = {"daily": raw.get("daily")}
            ttl = WATER_CACHE_TTL
    except (httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        payload = {"status": "unavailable", "reason": f"Open-Meteo недоступен ({type(exc).__name__})."}
        ttl = 180
    with _CACHE_LOCK:
        if len(_WATER_CACHE) >= 1024:
            # Bounded in-memory cache; avoid eviction races across requests.
            expired = [k for k, value in _WATER_CACHE.items() if value[0] <= time.monotonic()]
            for old in expired:
                _WATER_CACHE.pop(old, None)
            if len(_WATER_CACHE) >= 1024:
                _WATER_CACHE.pop(next(iter(_WATER_CACHE)))
        _WATER_CACHE[key] = (time.monotonic() + ttl, payload)
    return payload


async def build_agronomy(field: dict, forecast: dict) -> dict:
    leaf_rust = wheat_rust_screen(field, forecast)
    water_payload = await fetch_water_history(field)
    water = water_balance_7d(water_payload)
    return {
        "version": "4.0",
        "field_id": field["id"], "field_name": field["name"],
        "crop": field.get("crop", ""),
        "forecast_source": forecast.get("source", "unavailable"),
        "phytosanitary": leaf_rust,
        "water_context": water,
        "disclaimer": (
            "Погодный скрининг и референсный водный баланс; не диагноз, "
            "не прогноз урожайности и не агрономическое предписание."
        ),
    }
