"""Windows frozen executable smoke: full local admin CRUD + clearly labeled offline AI.

Must be executed on Windows after build_expert.ps1. Tests a COPY of the
distribution; neither GitHub repo nor work PC existing catalog is modified.
"""
from __future__ import annotations

import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
BUILT = ROOT / "dist" / "AgroRadar-Expert"


def request(opener, url, method="GET", data=None, headers=None):
    body = json.dumps(data).encode("utf-8") if data is not None else None
    actual_headers = dict(headers or {})
    if body is not None:
        actual_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, method=method, data=body, headers=actual_headers)
    with opener.open(req, timeout=8) as response:
        payload = response.read()
        if (response.headers.get("Content-Type", "").startswith("application/json")):
            return response.status, json.loads(payload)
        return response.status, payload


def main():
    assert (BUILT / "AgroRadar-Expert.exe").is_file(), "Must build exe first."
    with tempfile.TemporaryDirectory(prefix="agroradar-expert-smoke-") as location:
        dest = Path(location) / "AgroRadar-Expert"
        shutil.copytree(BUILT, dest)
        # Validate the actual zip-ready distribution, not the local builder tree.
        executable = dest / "AgroRadar-Expert.exe"
        assert not (dest / "settings.env").exists()
        assert not (dest / "data").exists()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        env = {**os.environ,
               "AGRORADAR_PORTABLE_PORT": str(port),
               "AGRORADAR_PORTABLE_NO_BROWSER": "1",
               "OPENWEATHER_API_KEY": "",
               "DEEPSEEK_API_KEY": "",
               "VITE_YANDEX_MAPS_API_KEY": "",
               "AGRORADAR_WATER_CONTEXT": "0"}
        log = dest.parent / "server-output.txt"
        with log.open("w", encoding="utf-8") as output:
            proc = subprocess.Popen([str(executable)], cwd=dest, env=env,
                                    stdout=output, stderr=subprocess.STDOUT)
            try:
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}),
                                                    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
                deadline = time.monotonic() + 90
                while time.monotonic() < deadline:
                    if proc.poll() is not None:
                        raise RuntimeError("Frozen server exited before ready:\n" + log.read_text(encoding="utf-8")[-7000:])
                    try:
                        status, result = request(opener, base + "/wifi/ping")
                        if status == 200 and result.get("ready"):
                            break
                    except (OSError, ValueError, urllib.error.URLError):
                        pass
                    time.sleep(0.45)
                else:
                    raise RuntimeError("Frozen server failed to bind:\n" + log.read_text(encoding="utf-8")[-7000:])
                status, index = request(opener, base + "/")
                assert status == 200 and b'<div id="root"' in index, "Compiled React SPA not served."
                status, profile = request(opener, base + "/api/auth/status")
                assert status == 200 and not profile["authenticated"]
                status, login = request(opener, base + "/api/auth/login",
                                        "POST", {"username": "admin", "password": "AgroRadar-Expert!2026"})
                assert status == 200 and login["role"] == "admin"
                auth = {"X-Agro-CSRF": login["csrf_token"]}
                status, fields = request(opener, base + "/api/fields")
                assert status == 200 and len(fields) == 4
                geometry = [[36.72, 50.6],[36.73, 50.6],[36.73, 50.61],
                            [36.72, 50.61],[36.72, 50.6]]
                status, created = request(opener, base + "/api/fields", "POST", {
                    "name":"Новая проверка жюри", "crop":"Пшеница",
                    "coordinates":geometry, "description":"Тестовая запись"}, auth)
                assert status == 201 and created["field"]["id"] == 5, created
                status, edited = request(opener, base + "/api/fields/5", "PUT", {
                    "name":"Отредактированное поле", "crop":"Пшеница",
                    "description":"Изменено экспертом"}, auth)
                assert status == 200 and edited["field"]["name"] == "Отредактированное поле"
                status, stored = request(opener, base + "/api/fields/5")
                assert status == 200 and stored["description"] == "Изменено экспертом"
                status, task = request(opener, base + "/api/operations/tasks", "POST",{
                    "field_id":5, "title":"Проверить поле",
                    "action":"Осмотреть посевы пшеницы на тестовом поле."}, auth)
                assert status == 201
                task_id = task["task"]["id"]
                status, _ = request(opener, base + f"/api/operations/tasks/{task_id}", "PUT",
                                    {"status":"in_progress"}, auth)
                assert status == 200
                status, completed = request(opener, base + f"/api/operations/tasks/{task_id}", "PUT",
                    {"status":"done","completion_note":"Проведён тестовый осмотр и записан результат."},auth)
                assert completed["task"]["status"] == "done"
                status, ai = request(opener, base + "/api/ai/chat", "POST",
                    {"field_id":5,"message":"Каковы риски?","history":[]}, auth)
                assert status == 200 and "НЕ DEEPSEEK" in ai["answer"].upper(), ai
                status, config = request(opener, base + "/api/public-config")
                assert status == 200 and config == {"yandex_maps_api_key": ""}
                status, deleted = request(opener, base + "/api/fields/5", "DELETE", headers=auth)
                assert status == 200 and deleted["deleted"]
                status, remaining = request(opener, base + "/api/fields")
                assert status == 200 and len(remaining) == 4
                assert (dest / "data" / "fields.json").exists()
                assert (dest / "data" / "monitoring.sqlite3").exists()
                print("EXPERT PORTABLE SMOKE: frozen EXE, React SPA, login, CRUD, tasks, offline AI, secrets boundary OK",flush=True)
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)

        # PowerShell 5.1 on a clean Windows machine MUST be able to create
        # a SEND archive after the real EXE created local demo records.
        # Verify secret injection and exclusion of all local user data.
        helper = dest / "ADD_MY_KEYS.ps1"
        assert helper.read_bytes().isascii(), "Legacy PowerShell 5.1 requires ASCII-only script or UTF8-BOM."
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
             "-File", str(helper), "-NonInteractive",
             "-OpenWeatherKey", "CI_OPENWEATHER",
             "-DeepSeekKey", "CI_DEEPSEEK",
             "-YandexKey", "CI_YANDEX"],
            cwd=dest, capture_output=True, text=True, timeout=120,
        )
        assert result.returncode == 0, (
            "PowerShell 5.1 ADD_MY_KEYS failed:\n"
            + result.stdout[-5000:] + "\n" + result.stderr[-5000:]
        )
        send = dest.parent / "AgroRadar-Expert-SEND.zip"
        assert send.is_file(), "SEND ZIP is missing"
        with zipfile.ZipFile(send) as archive:
            assert archive.testzip() is None
            names = archive.namelist()
            assert "AgroRadar-Expert.exe" in names
            assert "ADD_MY_KEYS.cmd" in names
            assert "ADD_MY_KEYS.ps1" in names
            assert "settings.env" in names
            assert any(name.startswith("_internal/") for name in names)
            assert not any(
                name.startswith("data/") or name.endswith("admin_access.txt")
                or name.endswith("viewer_accounts.json") or name.endswith(".sqlite3")
                for name in names
            ), "SEND ZIP leaked local evaluator data"
            env_settings = archive.read("settings.env").decode("utf-8")
            assert "OPENWEATHER_API_KEY=CI_OPENWEATHER" in env_settings
            assert "DEEPSEEK_API_KEY=CI_DEEPSEEK" in env_settings
            assert "VITE_YANDEX_MAPS_API_KEY=CI_YANDEX" in env_settings
        print("POWERSHELL 5.1 KEY HELPER SMOKE: real ZIP and all keys passed; data excluded", flush=True)


if __name__ == "__main__":
    main()
