"""Bounded, factual five-day forecast context for the AgroRadar AI assistant.

The forecast is already calculated by compose_field(); this module must not
fetch external weather data, re-run a risk model, or mutate stored forecasts.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


# Hourly details are useful for timing a field inspection, but waste tokens
# on broad questions that only need the five daily risk summaries.
_TIME_CUES = (
    "по час", "во сколько", "в какое время", "по времени", "интервал",
    "когда", "ноч", "утр", "вечер", "завтра", "послезавтра",
    "с какого часа", "в какие часы",
)
_POINT_FIELDS = (
    "temperature_c", "minimum_temperature_c", "rain_mm_3h",
    "precipitation_probability_pct", "wind_ms", "wind_gust_ms", "humidity_pct",
)


def _as_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _utc_at(value: Any) -> str | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec="minutes")
    except (ValueError, OverflowError, OSError):
        return None


def prepare_five_day_context(forecast: dict | None, question: str) -> dict:
    """Summarize at most five rolling 24h windows, preserving unknowns.

    Keep the already-computed independent daily risk assessments, rather than
    flattening five days of rain into one 24-hour threshold. An empty forecast
    never becomes a low-risk period.
    """
    source_data = _as_dict(forecast)
    source = source_data.get("source", "unavailable")
    raw_days = source_data.get("days")
    if not isinstance(raw_days, list):
        raw_days = []
    detailed = any(cue in question.casefold() for cue in _TIME_CUES)
    days: list[dict] = []

    for item in raw_days[:5]:
        day = _as_dict(item)
        risk = _as_dict(day.get("risk"))
        quality = _as_dict(day.get("data_quality"))
        crop = _as_dict(day.get("crop_risk_analysis"))
        assessments = day.get("assessments")
        if not isinstance(assessments, list):
            assessments = []

        summary = {
            "day": day.get("day"),
            "start_utc": day.get("start"),
            "end_utc": day.get("end"),
            "forecast_points": day.get("sample_count", 0),
            "min_temperature_c": day.get("min_temperature_c"),
            "max_temperature_c": day.get("max_temperature_c"),
            "precipitation_mm": day.get("precipitation_mm"),
            "weather_risk": {
                "level": risk.get("level", "unknown"),
                "reason": risk.get("reason"),
            },
            "weather_factors": [
                {
                    "id": a.get("id"), "level": a.get("level"),
                    "value": a.get("value"), "unit": a.get("unit"),
                    "reason": a.get("reason") if a.get("level") in ("high", "medium", "unknown") else None,
                }
                for row in assessments[:4] if (a := _as_dict(row))
            ],
            "data_quality": {
                "status": quality.get("status", "unavailable"),
                "limitations": quality.get("limitations") or [],
                "unknown_factors": day.get("unknown_count"),
            },
            "crop_research_preview": {
                "level": _as_dict(crop.get("overall")).get("level", "unknown"),
                "reason": crop.get("reason"),
                "approved_rules": crop.get("approved_rules", 0),
            },
        }

        if detailed:
            points = day.get("points")
            if not isinstance(points, list):
                points = []
            summary["forecast_intervals_3h"] = [
                {"at_utc": _utc_at(p.get("timestamp")),
                 **{key: p.get(key) for key in _POINT_FIELDS}}
                for point in points[:8] if (p := _as_dict(point))
            ]
        days.append(summary)

    return {
        "source": source,
        "issued_at_utc": source_data.get("issued_at"),
        "windows": "five consecutive rolling 24h periods from issued_at_utc (not calendar days)",
        "forecast_interval_hours": source_data.get("interval_hours", 3),
        "has_forecast_data": any((d.get("forecast_points") or 0) > 0 for d in days),
        "days": days,
        "notice": source_data.get("notice") or (
            "No five-day forecast; unavailable or missing periods are unknown, not safe."
        ),
    }
