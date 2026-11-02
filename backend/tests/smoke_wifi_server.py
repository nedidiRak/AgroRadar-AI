"""Standalone Windows CI smoke: run real Uvicorn with compiled mobile frontend.

No external APIs or actual network devices. The test binds the wildcard TCP
address but probes loopback, then cleanly terminates the child server.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def main() -> int:
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        raise RuntimeError("CI must build frontend/dist before the smoke test.")
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as check:
        check.bind(("0.0.0.0", 0))
        port = check.getsockname()[1]
    env = dict(os.environ)
    env.update({
        "AGRORADAR_WIFI_DEMO": "1",
        "AGRORADAR_WIFI_PORT": str(port),
        "AGRORADAR_WIFI_IPS": "192.168.50.25",
        "AGRORADAR_SECURE_COOKIES": "0",
        "OPENWEATHER_API_KEY": "",
        "DEEPSEEK_API_KEY": "",
    })
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0",
         "--port", str(port), "--no-access-log"],
        cwd=BACKEND, env=env,
    )
    try:
        url = f"http://127.0.0.1:{port}"
        ready = False
        for _ in range(60):
            if proc.poll() is not None:
                raise RuntimeError(f"Wi-Fi Uvicorn exited with code {proc.returncode}")
            try:
                with urllib.request.urlopen(url + "/wifi/ping", timeout=1) as response:
                    if json.load(response).get("mode") == "wifi_demo":
                        ready = True
                        break
            except (OSError, ValueError, urllib.error.URLError):
                pass
            time.sleep(0.35)
        if not ready:
            raise RuntimeError("Wi-Fi Uvicorn did not become ready.")
        with urllib.request.urlopen(url + "/", timeout=5) as response:
            page = response.read().decode("utf-8", "replace")
            if response.status != 200 or "<html" not in page.lower():
                raise AssertionError("Production SPA did not load.")
        with urllib.request.urlopen(url + "/wifi/connect", timeout=5) as response:
            page = response.read().decode("utf-8", "replace")
            if "192.168.50.25" not in page or "data:image/svg+xml;base64" not in page:
                raise AssertionError("Offline QR link missing from Wi-Fi guide.")
        with urllib.request.urlopen(url + "/api/auth/status", timeout=5) as response:
            state = json.load(response)
            if state["authenticated"] is not False:
                raise AssertionError("No unauthenticated user may be logged in.")
        print("WINDOWS WIFI SMOKE: SPA, QR, and auth-status reached over one TCP port.")
        return 0
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)


if __name__ == "__main__":
    sys.exit(main())
