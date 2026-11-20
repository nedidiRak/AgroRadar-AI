"""Real macOS .app smoke test after ditto archive extraction.

Covers both CPU builds in their native GitHub-hosted macOS environments.
No production credentials, real user files, or network API calls are used.
"""
from __future__ import annotations

import http.cookiejar
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
LABEL = "AppleSilicon" if platform.machine() == "arm64" else "Intel"
ARCHIVE = ROOT / "dist" / f"AgroRadar-Expert-macOS-{LABEL}.zip"


def call(opener, base, route, method="GET", payload=None, csrf=None):
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    if csrf:
        headers["X-Agro-CSRF"] = csrf
    req = urllib.request.Request(
        base + route, method=method, headers=headers,
        data=json.dumps(payload).encode() if payload is not None else None,
    )
    with opener.open(req, timeout=12) as response:
        raw = response.read()
        if response.headers.get("Content-Type", "").startswith("application/json"):
            return response.status, json.loads(raw)
        return response.status, raw


def main():
    assert ARCHIVE.is_file(), f"Missing macOS ZIP: {ARCHIVE}"
    with tempfile.TemporaryDirectory(prefix="agroradar-macos-real-zip-") as temporary:
        root = Path(temporary)
        unpacked = root / "unpacked"
        unpacked.mkdir()
        # Ditto handles .app symlinks, code resources and executable modes.
        subprocess.run(["ditto", "-x", "-k", str(ARCHIVE), str(unpacked)], check=True)
        apps = list(unpacked.glob("*/AgroRadar-Expert.app"))
        assert len(apps) == 1, f"Expected one native .app; found: {apps}"
        app = apps[0]
        binary = app / "Contents" / "MacOS" / "AgroRadar-Expert"
        assert os.access(binary, os.X_OK), "Mac app executable mode was lost in ZIP"
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
        assert (app.parent / "README_FIRST.txt").exists()
        assert not (app.parent / "settings.env").exists()
        assert not (app.parent / "data").exists()

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        support = root / "private-user-settings"
        env = {
            **os.environ,
            "AGRORADAR_EXPERT_HOME": str(support),
            "AGRORADAR_PORTABLE_PORT": str(port),
            "AGRORADAR_PORTABLE_NO_BROWSER": "1",
            "OPENWEATHER_API_KEY": "",
            "DEEPSEEK_API_KEY": "",
            "VITE_YANDEX_MAPS_API_KEY": "",
            "AGRORADAR_WATER_CONTEXT": "0",
        }
        log = root / "launch.log"
        with log.open("w", encoding="utf-8") as output:
            process = subprocess.Popen([str(binary)], env=env, cwd=str(app.parent),
                                       stdout=output, stderr=subprocess.STDOUT)
            try:
                opener = urllib.request.build_opener(
                    urllib.request.ProxyHandler({}),
                    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                )
                deadline = time.monotonic() + 110
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("App exited early:\n" + log.read_text(errors="replace")[-6000:])
                    try:
                        status, response = call(opener, base, "/wifi/ping")
                        if status == 200 and response.get("ready"):
                            break
                    except (OSError, ValueError, urllib.error.URLError):
                        pass
                    time.sleep(0.4)
                else:
                    raise RuntimeError("App did not become ready:\n" + log.read_text(errors="replace")[-6000:])

                status, index = call(opener, base, "/")
                assert status == 200 and b'<div id="root"' in index
                status, auth = call(opener, base, "/api/auth/login", "POST", {
                    "username": "admin", "password": "AgroRadar-Expert!2026"
                })
                assert status == 200 and auth["role"] == "admin"
                status, configuration = call(opener, base, "/api/public-config")
                assert status == 200 and configuration == {"yandex_maps_api_key": ""}
                csrf = auth["csrf_token"]
                status, fields = call(opener, base, "/api/fields")
                assert status == 200 and len(fields) == 4
                geo = [[36.72, 50.6], [36.73, 50.6], [36.73, 50.61],
                       [36.72, 50.61], [36.72, 50.6]]
                status, created = call(opener, base, "/api/fields", "POST", {
                    "name": "Тестовое поле Mac", "crop": "Пшеница",
                    "coordinates": geo, "description": "Проверка macOS"
                }, csrf)
                assert status == 201, created
                id_ = created["field"]["id"]
                status, updated = call(opener, base, f"/api/fields/{id_}", "PUT", {
                    "name": "Изменённое поле", "crop": "Пшеница",
                    "description": "Сохранено на Mac"
                }, csrf)
                assert status == 200 and updated["field"]["name"] == "Изменённое поле"
                status, _ = call(opener, base, "/api/operations/tasks", "POST", {
                    "field_id": id_, "title": "Проверить состояние",
                    "action": "Осмотреть поле после осадков"
                }, csrf)
                assert status == 201
                status, ai = call(opener, base, "/api/ai/chat", "POST", {
                    "field_id": id_, "message": "Что проверить?", "history": []
                }, csrf)
                assert status == 200 and "НЕ DEEPSEEK" in ai["answer"].upper()
                status, removed = call(opener, base, f"/api/fields/{id_}",
                                       "DELETE", csrf=csrf)
                assert status == 200 and removed["deleted"]
                assert (support / "data" / "fields.json").is_file()
                assert (support / "data" / "monitoring.sqlite3").is_file()
                assert (support / "settings.env.example").is_file()
                assert not (support / "settings.env").exists()
                assert not (app / "Contents" / "Resources" / "data").exists()
                print(f"PASS macOS native {LABEL}: extracted app, codesign, SPA, "
                      "admin login, fields CRUD, task, offline AI, writable data")
            finally:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
