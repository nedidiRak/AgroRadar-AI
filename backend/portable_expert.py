"""Self-contained, localhost-only Windows evaluator launcher.

Built as a PyInstaller onedir executable by GitHub Actions. Does not require
Python, Node.js, npm, administrator permissions, or any cloud account to run.
The test password is intentionally public and may ONLY be used for disposable,
isolated demo data served on 127.0.0.1. Never bundle production data/secrets.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

from dotenv import load_dotenv

DEFAULT_PASSWORD = "AgroRadar-Expert!2026"
ROOT = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]


def _select_port() -> int:
    chosen = os.getenv("AGRORADAR_PORTABLE_PORT", "").strip()
    candidates = [int(chosen)] if chosen.isdecimal() else [18765, 19080, 18766, 29080, 0]
    for port in candidates:
        if port < 0 or port > 65535:
            continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(("127.0.0.1", port))
                return sock.getsockname()[1]
        except OSError:
            continue
    raise RuntimeError("На компьютере нет свободного локального TCP-порта.")


def _open_when_ready(port: int) -> None:
    target = f"http://127.0.0.1:{port}/"
    probe = target + "wifi/ping"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(65):
        try:
            with opener.open(probe, timeout=1) as response:
                if response.status == 200 and json.load(response).get("ready"):
                    if os.getenv("AGRORADAR_PORTABLE_NO_BROWSER") != "1":
                        webbrowser.open(target)
                    return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.5)
    print(f"[WARNING] Не удалось подтвердить готовность браузера. Попробуй {target}", flush=True)


def main() -> None:
    os.chdir(ROOT)
    load_dotenv(ROOT / "settings.env", override=False)
    # Must never publish any admin access or backend over the LAN.
    os.environ["AGRORADAR_WIFI_DEMO"] = "1"
    os.environ["AGRORADAR_EXPERT_PORTABLE"] = "1"
    os.environ["AGRORADAR_WIFI_IPS"] = ""
    os.environ["AGRORADAR_WIFI_ADAPTERS"] = "[]"
    os.environ["AGRORADAR_SECURE_COOKIES"] = "0"
    os.environ["AGRORADAR_AUTO_MONITOR"] = "0"
    os.environ["AGRORADAR_DATA_DIR"] = str(ROOT / "data")
    asset_base = Path(getattr(sys, "_MEIPASS", ROOT))
    os.environ["AGRORADAR_FRONTEND_DIST"] = str(asset_base / "frontend" / "dist")
    if not (asset_base / "frontend" / "dist" / "index.html").is_file():
        raise RuntimeError("Нет встроенного интерфейса React. Скачай весь ZIP и распакуй папку целиком.")
    # The password in this disposable local evaluator build is NOT a real secret.
    # Never use these credentials for a real or network-facing deployment.
    os.environ["AGRORADAR_ADMIN_PASSWORD"] = DEFAULT_PASSWORD
    port = _select_port()
    os.environ["AGRORADAR_WIFI_PORT"] = str(port)
    print("=" * 67, flush=True)
    print(" AgroRadar AI 4.0 | EXPERT PORTABLE | локальная проверка", flush=True)
    print("=" * 67, flush=True)
    print("Адрес:    http://127.0.0.1:%d/" % port, flush=True)
    print("Логин:    admin", flush=True)
    print("Пароль:   " + DEFAULT_PASSWORD, flush=True)
    print("Доступ:   полный администратор, только этот компьютер", flush=True)
    print("Интернет: нужен для живой погоды, картографических тайлов и DeepSeek", flush=True)
    print("Без ключа DeepSeek работает ЧЕСТНО МАРКИРОВАННАЯ демоверсия диалога.", flush=True)
    print("Для остановки закрой это окно или нажми Ctrl+C.", flush=True)
    print("=" * 67, flush=True)

    # Single-process Uvicorn, no development reload or additional Node server.
    # Import *after* configuring the environment.
    from app.main import app
    import uvicorn

    threading.Thread(target=_open_when_ready, args=(port,), daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)


if __name__ == "__main__":
    # PyInstaller Windows runners use a legacy cp1252/866 console when
    # stdout is redirected. Force Unicode so Russian instructions cannot
    # crash the real frozen executable before server initialization.
    if sys.platform == "win32":
        os.system("chcp 65001 >NUL")
    for channel in (sys.stdout, sys.stderr):
        if hasattr(channel, "reconfigure"):
            channel.reconfigure(encoding="utf-8", errors="replace")
    try:
        main()
    except Exception as exc:
        print("\n[ERROR] Не удалось запустить AgroRadar:", type(exc).__name__, str(exc), flush=True)
        if sys.stdin and sys.stdin.isatty():
            input("Нажми Enter для выхода...")
        raise
