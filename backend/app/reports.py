"""Portable printable and CSV reports (no paid APIs or PDF service).

Browser printing of the self-contained HTML report supports Save as PDF on
Windows and mobile, with UTF-8 Cyrillic and no server-side font dependency.
"""
from __future__ import annotations

import asyncio
import csv
import html
import io
import sqlite3
from datetime import datetime, timezone
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, Response

from .monitoring import field_history

PLACEHOLDER = "Нет данных"


def _h(value) -> str:
    if value is None:
        return PLACEHOLDER
    return html.escape(str(value), quote=True)


def _csv_safe(value) -> str:
    """Prevent formula injection when opening downloaded CSV in Excel."""
    if value is None:
        return ""
    value = str(value).replace("\r", " ").replace("\n", " ")
    return "'" + value if value.startswith(("=", "+", "-", "@", "\t")) else value


def _csv_response(rows: list[list], filename: str) -> Response:
    output = io.StringIO(newline="")
    writer = csv.writer(output, delimiter=";")
    for row in rows:
        writer.writerow([_csv_safe(value) for value in row])
    return Response(
        content="\ufeff" + output.getvalue(), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"},
    )


def report_router(find_field: Callable[[int], dict],
                  compose: Callable[[dict], Awaitable[dict]],
                  effective_fields: Callable[[], list[dict]]) -> APIRouter:
    router = APIRouter(prefix="/api/reports", tags=["Отчёты и экспорт"])

    @router.get("/field/{field_id}.csv")
    async def field_csv(field_id: int):
        details = await compose(find_field(field_id))
        analysis = details["risk_analysis"]
        rows = [
            ["AgroRadar AI / отчёт по полю", details["name"]],
            ["Создано (UTC)", datetime.now(timezone.utc).isoformat(timespec="seconds")],
            ["Поле", details["name"]],
            ["Культура", details["crop"]],
            ["Фаза развития", details.get("growth_stage")],
            ["Почва", details.get("soil_type")],
            ["Дата посева", details.get("sowing_date")],
            ["Гектары", details["area_ha"]],
            ["Источник погоды", details["weather"]["source"]],
            ["Источник прогноза", details["forecast"]["source"]],
            ["Общий риск", details["risk"]["label"]],
            ["Полнота оценки", f'{analysis["known_count"]}/4'],
            [],
            ["Фактор", "Уровень", "Показатель", "Ед.", "Правило", "Рекомендация"],
        ]
        rows.extend([
            [item["title"], item["label"], item["value"], item["unit"],
             item["rule"], item["next_step"]]
            for item in analysis["assessments"]
        ])
        rows.extend([[], ["Ограничение", analysis["disclaimer"]]])
        return _csv_response(rows, f"agroradar-field-{field_id}.csv")

    @router.get("/overview.csv")
    async def overview_csv():
        # Use a single backend computation; never claim that demo data are LIVE.
        fields = await asyncio.gather(*(compose(field) for field in effective_fields()))
        rows = [
            ["Поле", "Культура", "Га", "Уровень", "Основание",
             "Источник погоды", "Источник прогноза", "Мин. температура, C",
             "Оценено факторов", "Всего факторов"],
        ]
        for field in fields:
            analysis = field["risk_analysis"]
            rows.append([
                field["name"], field["crop"], field["area_ha"],
                field["risk"]["label"], field["risk"]["reason"],
                field["weather"]["source"], field["forecast"]["source"],
                field["forecast"]["min_temperature_next_24h_c"],
                analysis["known_count"], 4,
            ])
        return _csv_response(rows, "agroradar-overview.csv")

    @router.get("/field/{field_id}", response_class=HTMLResponse)
    async def field_print(field_id: int):
        field = await compose(find_field(field_id))
        analysis = field["risk_analysis"]
        actions = analysis.get("priority_actions", [])
        quality = analysis.get("data_quality", {})
        try:
            history = field_history(field_id, 10)["snapshots"]
        except (OSError, sqlite3.Error):
            # History is auxiliary: a damaged SQLite sidecar must not prevent
            # downloading a current report from the working field catalog.
            history = []
        rows = "".join(
            f'<tr><td>{_h(item["title"])}</td><td>{_h(item["label"])}</td>'
            f'<td>{_h(item["value"])} {_h(item["unit"])}</td>'
            f'<td>{_h(item["reason"])}</td></tr>'
            for item in analysis["assessments"]
        )
        steps = "".join(
            f'<li><b>{_h(item["title"])}</b><p>{_h(item["action"])}</p>'
            f'<small>{_h(item["evidence"])}</small></li>'
            for item in actions
        )
        entries = "".join(
            f'<tr><td>{_h(item["created_at"])}</td><td>{_h(item["level"])}</td>'
            f'<td>{_h(item["source"])}</td><td>{_h(item["min_temperature_c"])}</td></tr>'
            for item in history[-10:]
        )
        produced = datetime.now(timezone.utc).isoformat(timespec="seconds")
        # All user-supplied field data are escaped; this is not an HTML template engine.
        page = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgroRadar AI — {_h(field['name'])}</title>
<style>
:root{{font-family:'Segoe UI',Arial,sans-serif;color:#17362b;background:#f2f7f3}}
body{{max-width:960px;margin:0 auto;padding:30px}}
header{{border-bottom:3px solid #207553;padding-bottom:18px}}
h1{{font-size:28px;margin:9px 0}}h2{{color:#176443;margin:25px 0 12px}}
.grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}}
.card{{padding:16px;background:#fff;border:1px solid #d0e1d6;border-radius:12px}}
.card small,.muted{{color:#657c70;font-size:12px}}
.card strong{{display:block;margin:8px 0;font-size:18px}}
table{{width:100%;border-collapse:collapse;background:white;font-size:12px}}
th,td{{border:1px solid #cbded1;text-align:left;padding:10px;vertical-align:top;overflow-wrap:anywhere}}
th{{background:#deeee3}}li{{padding:7px}}li p{{margin:5px 0}}
.notice{{background:#fff3db;border-left:4px solid #bd8736;padding:13px;line-height:1.6}}
button{{padding:10px 18px;background:#207553;color:white;border:0;border-radius:8px;cursor:pointer}}
footer{{font-size:11px;color:#688070;margin-top:32px}}
@media print{{body{{margin:0;padding:8mm;max-width:none}}.no-print{{display:none}}
h2,table,li{{break-inside:avoid}}@page{{size:A4;margin:12mm}}}}
@media(max-width:630px){{.grid{{grid-template-columns:1fr}}body{{padding:15px}}}}
</style></head><body>
<div class="no-print"><button onclick="window.print()">Печать / сохранить в PDF</button></div>
<header><small>AGRO RADAR AI · ОТЧЁТ ДЛЯ АГРОНОМА</small>
<h1>{_h(field["name"])}</h1><p>Сформирован: {_h(produced)} UTC</p></header>
<section class="grid">
<div class="card"><small>Культура</small><strong>{_h(field["crop"])}</strong>
<small>Фаза: {_h(field.get("growth_stage") or "Не указана")}</small></div>
<div class="card"><small>Площадь</small><strong>{_h(field["area_ha"])} га</strong>
<small>Почва: {_h(field.get("soil_type") or "Не указана")}</small></div>
<div class="card"><small>Погодный риск</small><strong>{_h(field["risk"]["label"])}</strong>
<small>{_h(field["risk"]["reason"])}</small></div>
</section>
<h2>Источник и полнота данных</h2>
<p><strong>Погода:</strong> {_h(field["weather"]["source"])}.
<strong>Прогноз:</strong> {_h(field["forecast"]["source"])}.
<strong>Факторы:</strong> {_h(analysis["known_count"])}/4.
<strong>Точек прогноза:</strong> {_h(quality.get("forecast_points"))}.</p>
<div class="notice">Демо и модельный прогноз — не прямые измерения на поле.
{_h(analysis["disclaimer"])}</div>
<h2>Проверка погодных факторов</h2>
<table><thead><tr><th>Фактор</th><th>Уровень</th><th>Значение</th><th>Причина</th></tr></thead>
<tbody>{rows}</tbody></table>
<h2>Приоритетные действия</h2><ol>{steps}</ol>
<h2>История риска</h2>
<table><thead><tr><th>Время (UTC)</th><th>Уровень</th><th>Источник</th><th>Мин., °C</th></tr></thead>
<tbody>{entries or '<tr><td colspan="4">История ещё не накоплена.</td></tr>'}</tbody></table>
<footer>Gorin's team · IT-спринт · Прототип. Результаты требуют проверки агрономом.</footer>
</body></html>"""
        return HTMLResponse(content=page, headers={"Cache-Control": "no-store",
                           "X-Content-Type-Options": "nosniff",
                           "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"},
        )

    return router
