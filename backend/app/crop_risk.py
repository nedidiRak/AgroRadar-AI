"""Evidence-aware, additive crop-specific AgroRisk screening (research preview).

No rule in the supplied reconstructed research catalog is approved for production.
A candidate threshold may only trigger an AMBER research advisory, never a red
damage prediction. Non-matching / missing evidence is UNKNOWN, not green.
The original weather-risk engine and field geometry are untouched.
"""
from __future__ import annotations

import json
import unicodedata
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .risk_engine import numeric

router = APIRouter(tags=["Культуры и научные правила"])
DATA_FILE = Path(__file__).with_name("agrorisk_research.json")
TRUSTED_SIMPLE_METRICS = {"air_temperature_2m"}
ALLOWED_REQUIREMENTS = {"air_temperature", "bbch_confirmed", "pollination_confirmed"}
STAGE_TITLES = {
    "germination": "Прорастание", "flowering": "Цветение",
    "around_anthesis": "Период цветения", "winter_dormancy": "Зимний покой",
    "early_vegetative": "Начальная вегетация",
    "germination_imbibition": "Набухание семян", "pollination": "Опыление",
    "seedling": "Всходы", "anthesis": "Цветение (антезис)",
    "flowering_early_reproductive": "Начало цветения",
    "mid_season": "Середина вегетации", "vegetative": "Вегетация",
}


@lru_cache(maxsize=1)
def catalog() -> dict:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    if len(data.get("crops", [])) != 50 or len(data.get("rules", [])) != 85:
        raise RuntimeError("Research catalog is incomplete; refusing to calculate risks")
    return data


def _clean(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(unicodedata.normalize("NFKC", value).strip().casefold().replace("ё", "е").split())


def crop_by_id(crop_id: str | None) -> dict | None:
    return next((x for x in catalog()["crops"] if x["crop_id"] == crop_id), None)


def resolve_crop_id(crop: str | None, explicit_id: str | None = None) -> str | None:
    # An invalid explicit ID is never silently replaced by a guessed one.
    if explicit_id:
        return explicit_id if crop_by_id(explicit_id) else None
    normalized = _clean(crop)
    matches = [x["crop_id"] for x in catalog()["crops"]
               if _clean(x["name_ru"]) == normalized and normalized]
    # Ambiguous legacy entries e.g. "пшеница"/"кукуруза" remain unknown.
    return matches[0] if len(matches) == 1 else None


def crop_stages(crop_id: str) -> list[dict]:
    observed = sorted({r["stage"] for r in catalog()["rules"]
                       if r["crop_id"] == crop_id
                       and r.get("interpretation") not in ("unknown", "model_parameter")})
    return [{"code": s, "label": STAGE_TITLES.get(s, s),
             "bbch": None, "bbch_status": "not_validated"} for s in observed]


def _reported_points(forecast: dict) -> list[float]:
    points = forecast.get("points") or []
    if not isinstance(points, list):
        return []
    return [t for p in points if isinstance(p, dict)
            if (t := numeric(p.get("temperature_c"))) is not None]


def _assessment(rule: dict, level: str, reason: str, *, value=None) -> dict:
    return {
        "rule_id": rule["rule_id"], "factor": rule["factor"], "level": level,
        "title": STAGE_TITLES.get(rule["stage"], rule["stage"]),
        "stage_code": rule["stage"], "measurement_type": rule["measurement_type"],
        "value": value, "threshold": rule["threshold"],
        "evidence_class": rule["evidence_class"],
        "review_status": "candidate" if rule.get("interpretation") == "candidate" else "research_only",
        "confidence": rule["confidence"], "source_urls": rule.get("source_urls") or [],
        "reason": reason, "limitations": rule.get("limitations") or "",
    }


def evaluate_crop_risk(field: dict | None, forecast: dict) -> dict:
    """Only supported, user-selected stages and matching forecast metrics may warn.

    Crop-specific risk stays separate from the legacy four weather factors.
    No 'red' or 'green' follows from the supplied unapproved research rules.
    """
    field = field or {}
    cid = resolve_crop_id(field.get("crop"), field.get("crop_id"))
    stage = field.get("crop_stage_code") or None
    source = forecast.get("source", "unavailable")
    data = catalog()
    result = {
        "version": "4.0-research-preview",
        "ruleset_version": data["schema_version"],
        "crop_id": cid, "crop_name": crop_by_id(cid)["name_ru"] if cid else None,
        "stage_code": stage, "stage_label": STAGE_TITLES.get(stage, stage) if stage else None,
        "source": source, "simulated": source in ("demo", "scenario"),
        "overall": {"level": "unknown", "label": "Недостаточно данных"},
        "assessments": [], "approved_rules": 0,
        "disclaimer": "Научно-исследовательский скрининг; пороги не прошли полевую валидацию. Желтая подсказка НЕ означает подтвержденное повреждение урожая. Серый НЕ означает безопасность.",
    }
    if not cid:
        result["reason"] = "Культура не сопоставлена однозначно со справочником. Выберите её из каталога."
        return result
    if not stage:
        result["reason"] = "Не указана подтверждённая пользователем фаза развития. Общие погодные риски доступны отдельно."
        return result
    possible = [r for r in data["rules"] if r["crop_id"] == cid
                and r["stage"] == stage and r.get("interpretation") != "unknown"]
    if not possible:
        result["reason"] = "Для сочетания культуры и стадии нет научных правил в исследовательской базе."
        return result
    if source == "unavailable":
        result["reason"] = "Погодный прогноз недоступен, выводить безопасность нельзя."
        return result
    temps = _reported_points(forecast)
    for rule in possible:
        measurement = rule.get("measurement_type")
        requirements = set(rule.get("data_requirement") or [])
        threshold = rule["threshold"]
        op = threshold.get("operator")
        value = numeric(threshold.get("value"))
        if (measurement not in TRUSTED_SIMPLE_METRICS or
                requirements - ALLOWED_REQUIREMENTS or
                rule.get("interpretation") not in ("candidate",) or
                op not in ("<", "<=", ">", ">=") or value is None):
            result["assessments"].append(_assessment(rule, "unknown",
                "Для этого исследования нужны дополнительные измерения, длительность экспозиции или экспертное подтверждение типа правила."))
            continue
        if not temps:
            result["assessments"].append(_assessment(rule, "unknown",
                "Нет прогнозных температур воздуха для проверки кандидата."))
            continue
        exceeded = [t for t in temps if (t < value if op == "<" else
                                         t <= value if op == "<=" else
                                         t > value if op == ">" else t >= value)]
        if exceeded:
            observed = max(exceeded) if op in (">", ">=") else min(exceeded)
            result["assessments"].append(_assessment(
                rule, "medium",
                f"В {len(exceeded)} прогнозных точках из {len(temps)} выполнен ориентир "
                f"{op} {value:g} °C. Точки с шагом 3 часа НЕ доказывают длительность воздействия.",
                value=observed))
        else:
            result["assessments"].append(_assessment(
                rule, "unknown",
                f"В {len(temps)} доступных точках ориентир не превышен. "
                "Это не доказательство отсутствия риска: порог предварительный."))
    if any(a["level"] == "medium" for a in result["assessments"]):
        result["overall"] = {"level": "medium", "label": "Требует внимания"}
        result["reason"] = "Зафиксировано превышение исследовательского ориентира; проверьте поле и научные ограничения."
    else:
        result["reason"] = "Нет утверждённого правила для автоматического вывода об отсутствии агрономического риска."
    return result


class ResearchEvaluationInput(BaseModel):
    crop_id: str = Field(min_length=1, max_length=70)
    crop_stage_code: str = Field(min_length=1, max_length=80)
    source: str = "scenario"
    points: list[dict] = Field(default_factory=list, max_length=40)


@router.get("/api/crops")
def list_crops(query: str = "", group: str = ""):
    if len(query) > 100 or len(group) > 80:
        raise HTTPException(422, "Слишком длинный запрос")
    crops = [dict(c, stages=crop_stages(c["crop_id"]))
             for c in catalog()["crops"]
             if (not group or c["group"] == group)
             and (not query or _clean(query) in _clean(c["name_ru"]))]
    return {"crops": crops, "count": len(crops),
            "notice": "50 культур в справочнике; наличие культуры не подтверждает точность правил повреждения."}


@router.get("/api/crops/{crop_id}/phenology")
def get_phenology(crop_id: str):
    crop = crop_by_id(crop_id)
    if not crop:
        raise HTTPException(404, "Культура не найдена")
    return {"crop_id": crop_id, "stages": crop_stages(crop_id),
            "notice": "Стадии исследовательские; BBCH пока не подтверждён, автоматической фенологии нет."}


@router.get("/api/risk-rules/version")
def rules_version():
    return {"version": catalog()["schema_version"], "total_rules": 85,
            "crop_count": 50, "approved_rules": 0,
            "status": "research_only", "message": "Ни одно правило не одобрено для производственного применения."}


@router.get("/api/risk-rules")
def risk_rules(crop_id: str = "", stage: str = "", factor: str = ""):
    rules = [r for r in catalog()["rules"]
             if (not crop_id or r["crop_id"] == crop_id)
             and (not stage or r["stage"] == stage)
             and (not factor or r["factor"] == factor)]
    return {"rules": rules, "count": len(rules), "version": catalog()["schema_version"]}


@router.get("/api/risk-rules/{rule_id}")
def risk_rule(rule_id: str):
    rule = next((r for r in catalog()["rules"] if r["rule_id"] == rule_id), None)
    if not rule:
        raise HTTPException(404, "Правило не найдено")
    sources = {sid: catalog()["sources"].get(sid) for sid in rule.get("source_ids", [])}
    return {"rule": rule, "sources": sources, "review_status": "candidate",
            "version": catalog()["schema_version"]}


@router.post("/api/risks/evaluate")
def evaluate_supplied_forecast(payload: ResearchEvaluationInput):
    if payload.source not in ("scenario", "demo"):
        raise HTTPException(422, "Ручная оценка разрешена только как явно помеченная симуляция.")
    return evaluate_crop_risk(
        {"crop_id": payload.crop_id, "crop_stage_code": payload.crop_stage_code},
        {"source": payload.source, "points": payload.points},
    )
