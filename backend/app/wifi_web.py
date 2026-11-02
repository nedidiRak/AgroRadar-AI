"""Secure local Wi-Fi demo page and pre-built React SPA hosting.

Disabled by default. In demo mode, Vite's development server is NOT exposed
to the network; FastAPI serves the compiled React assets from frontend/dist.
The same origin handles both /api and frontend traffic.
"""
from __future__ import annotations

import base64
import html
import io
import ipaddress
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


def demo_addresses() -> list[str]:
    raw = os.getenv("AGRORADAR_WIFI_IPS", "")
    result: list[str] = []
    for candidate in raw.split(";"):
        try:
            ip = ipaddress.IPv4Address(candidate.strip())
        except ipaddress.AddressValueError:
            continue
        if ip.is_loopback or ip.is_unspecified or ip.is_multicast or ip.is_link_local:
            continue
        if str(ip) not in result:
            result.append(str(ip))
    return result[:12]


def _qr_image(url: str) -> str:
    """Fully offline QR; no external QR-generation website receives demo URLs."""
    try:
        import qrcode
        from qrcode.image.svg import SvgPathImage

        image = qrcode.make(url, image_factory=SvgPathImage, box_size=7, border=3)
        stream = io.BytesIO()
        image.save(stream)
        return (
            '<img class="qr" alt="QR-код адреса AgroRadar AI" src="data:image/svg+xml;base64,'
            + base64.b64encode(stream.getvalue()).decode("ascii") + '">'
        )
    except ImportError:
        return '<p class="qr-missing">QR-модуль не установлен. Адрес можно открыть вручную.</p>'


def connect_page(port: int) -> HTMLResponse:
    cards = []
    for address in demo_addresses():
        url = f"http://{address}:{port}/"
        clean = html.escape(url, quote=True)
        cards.append(
            f'<article class="card">{_qr_image(url)}'
            f'<div><h2>{clean}</h2>'
            f'<p>Открой этот адрес или отсканируй QR-код с телефона в той же сети.</p>'
            f'<a class="btn" href="{clean}">Проверить адрес на этом компьютере</a></div></article>'
        )
    content = (
        "\n".join(cards) if cards else
        '<div class="warning">Не обнаружен пригодный IPv4-адрес сети. '
        'Подключи ноутбук к Wi-Fi и повторно запусти DEMO_WIFI.bat. '
        'При сложной сетевой конфигурации можно задать адрес вручную.</div>'
    )
    page = """<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgroRadar AI — подключение жюри</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b1712;color:#e0f2e7;font:15px/1.6 Segoe UI,Arial,sans-serif}
main{max-width:1000px;margin:0 auto;padding:30px 16px 65px}
h1{font-size:clamp(26px,5vw,38px);margin:0 0 10px}
h2{font-size:clamp(15px,3vw,21px);overflow-wrap:anywhere;color:#b1efd0}
p{color:#b1cdbc}.eyebrow{color:#82d6a4;font-size:12px;font-weight:800;letter-spacing:.12em}
.panel{border:1px solid #386e4a;border-radius:16px;background:#142e21;padding:22px;margin-top:20px}
.card{display:flex;align-items:center;gap:28px;background:#192d22;border:1px solid #3c604d;border-radius:16px;margin-top:17px;padding:20px}
.card img{width:220px;height:220px;max-width:48%;background:white;border:8px solid white;border-radius:10px}
.card>div{min-width:0;flex:1}.btn{display:inline-block;background:#277e54;color:white;padding:10px 15px;border-radius:9px;text-decoration:none;font-weight:700}
.warning{padding:15px;border:1px solid #987339;background:#49351d;border-radius:10px;margin-top:20px}
ul{padding-left:22px}li{padding:4px 0}.note{color:#e6cb97}
@media(max-width:650px){.card{flex-direction:column;text-align:center}.card img{max-width:100%;width:215px;height:215px}}
</style></head><body><main>
<div class="eyebrow">GORIN'S TEAM · IT-СПРИНТ</div>
<h1>Подключение к AgroRadar AI</h1>
<p>Приложение работает на этом ноутбуке. Жюри открывает мобильный интерфейс прямо в браузере без установки.</p>
<section class="panel">
<h2>1. Подключи телефон к той же Wi-Fi-сети</h2>
<p>Используй основной Wi-Fi или собственный доверенный хот-спот. Гостевые сети могут запрещать связь устройств между собой.</p>
<h2>2. Отсканируй один из QR-кодов</h2>
<p>Если ноутбук подключён к нескольким сетям, выбери адрес именно той сети, в которой находится телефон.</p>
</section>
""" + content + """
<section class="panel">
<h2>3. Войди как наблюдатель</h2>
<p>Администратор заранее создаёт отдельных наблюдателей в разделе «Пользователи». Они видят поля и общаются с ИИ, но не могут менять информацию.</p>
<p class="note">Администраторский вход с телефонов заблокирован в Wi-Fi-режиме. Для администрирования открой на ноутбуке адрес 127.0.0.1 с указанным портом.</p>
<h2>Если страница на телефоне не открылась</h2>
<ul><li>Проверь, что ноутбук и телефон действительно в одной Wi-Fi-сети.</li>
<li>Убедись, что профиль сети Windows — «Частная» и для демо-порта разрешён брандмауэр только в локальной подсети.</li>
<li>Если сеть изолирует клиентов, используй собственный хот-спот или отдельный маршрутизатор.</li>
<li>Если IP-адрес изменился, перезапусти DEMO_WIFI.bat для обновления QR-кодов.</li></ul>
</section>
<footer><p>Локальная демонстрация. Соединение HTTP не шифрует трафик — не используй чувствительные реальные данные на общей сети.</p></footer>
</main></body></html>"""
    return HTMLResponse(page, headers={"Cache-Control": "no-store",
                                      "X-Content-Type-Options": "nosniff",
                                      "Referrer-Policy": "no-referrer",
                                      "Content-Security-Policy":
                                      "default-src 'none'; img-src data:; style-src 'unsafe-inline'"})


def enable_wifi_site(app: FastAPI, dist_dir: Path | None = None) -> None:
    """Called only from the DEMO_WIFI mode after all API routers are installed."""
    folder = Path(dist_dir) if dist_dir is not None else FRONTEND_DIST
    if not (folder / "index.html").is_file():
        raise RuntimeError(
            "Отсутствует frontend/dist/index.html. Запусти DEMO_WIFI.bat — "
            "он собирает мобильный интерфейс перед запуском."
        )
    try:
        port = int(os.getenv("AGRORADAR_WIFI_PORT", "18765"))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError as exc:
        raise RuntimeError("Неверный порт Wi-Fi демонстрации.") from exc

    @app.get("/wifi/connect", response_class=HTMLResponse, include_in_schema=False)
    def wifi_connection_page():
        return connect_page(port)

    @app.get("/wifi/ping", include_in_schema=False)
    def wifi_ping():
        return JSONResponse({"ready": True, "mode": "wifi_demo"},
                            headers={"Cache-Control": "no-store"})

    # Mount last! API and the Wi-Fi landing page must take precedence.
    # StaticFiles resolves paths only inside the compiled frontend/dist folder.
    app.mount("/", StaticFiles(directory=str(folder), html=True), name="wifi_frontend")
