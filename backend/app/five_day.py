"""Five consecutive 24-hour weather screening windows (not a crop-loss model).

Uses the existing verified AgroRisk Engine 3.0 rules on EACH day's forecast
points independently. No additional provider calls are required.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .risk_engine import analyze_risks, numeric
from .crop_risk import evaluate_crop_risk

DAY_SECONDS = 24 * 3600
MAX_DAYS = 5
FORECAST_SOURCE = "openweather_forecast_3h"


def _utc(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="seconds")


def build_five_day_forecast(
    points: list[dict[str, Any]],
    source: str,
    field: dict | None = None,
    *,
    issued_at: int,
) -> dict:
    """Return five rolling 24-hour windows starting at forecast request time.

    The first window matches the existing 24h view. Each following window
    uses its OWN 3h intervals and rainfall total, never five-day accumulated
    rain against a one-day threshold. Missing windows remain 'unknown'.
    """
    issued_at = int(issued_at)
    good = sorted(
        (p for p in points if isinstance(p, dict)
         and isinstance(p.get("timestamp"), (int, float))
         and not isinstance(p.get("timestamp"), bool)),
        key=lambda p: p["timestamp"],
    )
    days = []
    for index in range(MAX_DAYS):
        start = issued_at + index * DAY_SECONDS
        end = start + DAY_SECONDS
        segment = [p for p in good if start <= p["timestamp"] < end]
        minimums = [numeric(p.get("minimum_temperature_c")) for p in segment]
        minimums = [
            v if v is not None else numeric(p.get("temperature_c"))
            for v, p in zip(minimums, segment)
        ]
        valid_minimums = [v for v in minimums if v is not None]
        minimum = min(valid_minimums) if valid_minimums else None
        temperatures = [numeric(p.get("temperature_c")) for p in segment]
        temperatures = [v for v in temperatures if v is not None]
        rain = [numeric(p.get("rain_mm_3h")) for p in segment]
        total_rain = round(sum(rain), 2) if segment and all(v is not None for v in rain) else None
        analysis = analyze_risks({}, {
            "source": source if segment else "unavailable",
            "points": segment, "period_hours": 24,
            "min_temperature_next_24h_c": minimum,
        }, field)
        days.append({
            "day": index + 1,
            "start": _utc(start),
            "end": _utc(end),
            "sample_count": len(segment),
            "min_temperature_c": minimum,
            "max_temperature_c": max(temperatures) if temperatures else None,
            "precipitation_mm": total_rain,
            "risk": analysis["overall"],
            "crop_risk_analysis": evaluate_crop_risk(field, {"source": source if segment else "unavailable", "points": segment}),
            "assessments": analysis["assessments"],
            "unknown_count": analysis["unknown_count"],
            "data_quality": analysis["data_quality"],
            "points": segment,
        })
    return {
        "source": source,
        "issued_at": _utc(issued_at),
        "interval_hours": 3,
        "days": days,
        "notice": (
            "Прогнозные модельные значения, не фактические наблюдения на поле. "
            "Пять последовательных 24-часовых периодов; пороги применяются к каждому "
            "периоду отдельно. Дальние и неполные прогнозы менее надёжны. "
            "Риски — учебный погодный скрининг, а не вероятность потери урожая."
        ),
    }
