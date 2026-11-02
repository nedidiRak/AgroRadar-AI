"""AgroRisk Engine 3.0: transparent decision support on top of weather rules.

This module deliberately DOES NOT adjust crop-damage thresholds using unverified
field metadata. It combines traceable weather warnings with user-entered context,
honest data-coverage messages, and conservative next steps for agronomists.
"""
from __future__ import annotations

from typing import Any


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def build_decision_support(analysis: dict, forecast: dict, field: dict | None) -> dict:
    """Pure, deterministic augmentation. Never alters baseline risk levels."""
    profile = field or {}
    crop = _text(profile.get("crop"))
    stage = _text(profile.get("growth_stage"))
    soil = _text(profile.get("soil_type"))
    sowing_date = _text(profile.get("sowing_date"))
    observations = profile.get("observations")
    observation_count = len(observations) if isinstance(observations, list) else 0
    # Missing fields are questions for the operator, never fabricated measurements.
    missing = []
    if not crop:
        missing.append("Культура")
    if not stage:
        missing.append("Фаза развития")
    if not soil:
        missing.append("Тип почвы")
    if not sowing_date:
        missing.append("Дата посева")

    context = {
        "crop": crop or None,
        "growth_stage": stage or None,
        "soil_type": soil or None,
        "sowing_date": sowing_date or None,
        "observation_count": observation_count,
        "source": "operator_entered_unverified" if field else "not_selected",
        "missing": missing,
        "interpretation": (
            "Культура, фаза и почва введены пользователем и помогают определить, "
            "что проверять на участке. Они не изменяют учебные погодные пороги."
        ),
    }

    source = str(forecast.get("source", "unknown"))
    points = forecast.get("points")
    count = len(points) if isinstance(points, list) else 0
    unknown_count = int(analysis.get("unknown_count", 0))
    known_count = int(analysis.get("known_count", 0))
    limitations = []

    if source == "demo":
        status, label = "demo", "Демонстрационные данные"
        limitations.append("Демонстрационный прогноз синтетический, не является реальной погодой.")
    elif source == "scenario":
        status, label = "simulation", "Учебная симуляция"
        limitations.append("Сценарий создан для проверки правил и не относится к реальным полям.")
    elif source == "unavailable":
        status, label = "unavailable", "Нет погодных данных"
        limitations.append("Источник погоды недоступен. Отсутствие оценки не означает отсутствие риска.")
    else:
        status, label = "available", "Данные прогноза доступны"

    if unknown_count:
        limitations.append(
            f"Не удалось оценить {unknown_count} из 4 погодных факторов: недостаточно исходных данных."
        )
    # Treat 3-hour forecast timestamps as sample points, NOT continuous measurements.
    if status == "available" and count < 6:
        limitations.append(
            f"Всего {count} прогнозных 3-часовых точек в выбранном окне; временной охват ограничен."
        )
    if status == "available" and (unknown_count or count < 6):
        status, label = "partial", "Прогноз неполный"
    if status == "available":
        limitations.append("Это модельный прогноз по координатам, а не датчик на поле.")

    quality = {
        "status": status,
        "label": label,
        "source": source,
        "forecast_points": count,
        "expected_interval_hours": 3,
        "known_factors": known_count,
        "unknown_factors": unknown_count,
        "factor_coverage_complete": unknown_count == 0,
        "limitations": limitations,
        "note": "Число точек не является процентом покрытых суток или достоверностью прогноза.",
    }

    # Order by measured weather alert severity, not by crop-sensitive probabilities.
    severity = {"high": 0, "medium": 1}
    raised = sorted(
        (item for item in analysis.get("assessments", [])
         if item.get("level") in severity),
        key=lambda item: (severity[item["level"]], item.get("id", "")),
    )
    actions = []
    for item in raised:
        explanation = item["reason"]
        recommendation = item["next_step"]
        if crop or stage:
            details = []
            if crop:
                details.append(f"культуру «{crop}»")
            if stage:
                details.append(f"фазу «{stage}»")
            recommendation += " При проверке учитывайте " + " и ".join(details) + " (сведения пользователя)."
        actions.append({
            "id": f"check_{item['id']}",
            "level": item["level"],
            "title": f"Проверить: {item['title'].lower()}",
            "why": explanation,
            "action": recommendation,
            "evidence": f"Правило: {item['rule']}. Источник: {item['data_source']}.",
            "basis": "weather_screening_rule",
        })

    if unknown_count:
        unknown_names = ", ".join(
            item["title"].lower() for item in analysis.get("assessments", [])
            if item.get("level") == "unknown"
        )
        actions.append({
            "id": "verify_missing_weather",
            "level": "unknown",
            "title": "Уточнить недостающие погодные данные",
            "why": f"Не оценены: {unknown_names}.",
            "action": "Обновить прогноз или провести проверку условий на участке. Не считать поле безопасным без данных.",
            "evidence": f"Источник: {source}; доступно 3-часовых точек: {count}.",
            "basis": "missing_weather_data",
        })

    if not raised and not unknown_count:
        actions.append({
            "id": "routine_monitoring",
            "level": "low",
            "title": "Продолжить наблюдение за полем",
            "why": "По четырём учебным погодным правилам повышенных рисков не найдено.",
            "action": "Следить за обновлением прогноза и фиксировать реальные наблюдения. Это не гарантия отсутствия агрономических угроз.",
            "evidence": f"Источник: {source}; погодных факторов: {known_count} из 4.",
            "basis": "weather_screening_rule",
        })

    if field and (not stage or not soil) and (raised or unknown_count):
        gaps = " и ".join(value.lower() for value in missing if value in ("Фаза развития", "Тип почвы"))
        actions.append({
            "id": "complete_field_profile",
            "level": "unknown",
            "title": "Уточнить агрономический паспорт",
            "why": f"Не указаны: {gaps}.",
            "action": "Заполнить сведения после проверки на месте; они нужны для предметной консультации, но не заменяют измерения.",
            "evidence": "Источник: карточка поля, сведения пользователя.",
            "basis": "missing_field_context",
        })

    return {
        "data_quality": quality,
        "field_context": context,
        "priority_actions": actions[:5],
        "decision_support_notice": (
            "Приоритеты и рекомендации — объяснимый учебный скрининг, "
            "не диагноз болезни, не вероятность потерь и не предписание обработки."
        ),
    }
