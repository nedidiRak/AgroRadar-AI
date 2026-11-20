"""Offline regression tests for one-origin LAN demo and trusted login boundaries."""
from __future__ import annotations

import io
import socket
from types import SimpleNamespace
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import demo_wifi
from app import auth, main, wifi_web


def test_lan_ipv4_validation_and_wildcard_port_collision():
    for address in ("192.168.50.4", "10.0.0.15", "172.16.9.3", "100.70.0.22"):
        assert demo_wifi.valid_lan_ip(address)
    for address in ("127.0.0.1", "0.0.0.0", "169.254.12.1", "224.0.0.1",
                    "8.8.8.8", "", "http://192.168.1.2", "::1"):
        assert not demo_wifi.valid_lan_ip(address)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("0.0.0.0", 0))
        selected = listener.getsockname()[1]
        with pytest.raises(RuntimeError):
            demo_wifi.choose_port(selected)


@pytest.mark.parametrize("labels_available", [True, False])
def test_macos_lists_active_lan_addresses_with_two_commands(monkeypatch, labels_available):
    monkeypatch.setattr(demo_wifi.sys, "platform", "darwin")
    commands = []
    interfaces = (
        "en1: flags=8863<UP,BROADCAST,RUNNING> mtu 1500\n"
        "\tinet 192.168.1.15 netmask 0xffffff00\n\tstatus: active\n"
        "en0: flags=8863<UP,BROADCAST,RUNNING> mtu 1500\n"
        "\tinet 192.168.1.24 netmask 0xffffff00\n\tstatus: active\n"
        "utun0: flags=8051<UP,POINTOPOINT,RUNNING> mtu 1380\n\tinet 10.8.1.1\n"
        "bridge0: flags=8863<UP,BROADCAST,RUNNING> mtu 1500\n\tinet 192.168.64.1\n"
        "en5: flags=8863<UP,BROADCAST,RUNNING> mtu 1500\n"
        "\tinet 192.168.1.65\n\tstatus: inactive\n"
    )
    labels = "Hardware Port: Ethernet\nDevice: en1\n\nHardware Port: Wi-Fi\nDevice: en0\n"

    def fake_run(command, **_kwargs):
        commands.append(tuple(command))
        if command[0] == "/sbin/ifconfig":
            return SimpleNamespace(stdout=interfaces, returncode=0)
        if not labels_available:
            raise FileNotFoundError("networksetup")
        return SimpleNamespace(stdout=labels, returncode=0)

    monkeypatch.setattr(demo_wifi.subprocess, "run", fake_run)
    adapters = demo_wifi.discover_ipv4()
    addresses = {item["alias"]: item["ip"] for item in adapters}
    if labels_available:
        assert addresses == {"Wi-Fi": "192.168.1.24", "Ethernet": "192.168.1.15"}
        assert adapters[0]["alias"] == "Wi-Fi"
    else:
        assert addresses == {"en0": "192.168.1.24", "en1": "192.168.1.15"}
    assert commands == [("/sbin/ifconfig", "-a"), ("/usr/sbin/networksetup", "-listallhardwareports")]


def test_terminal_qr_contains_phone_url(capsys):
    demo_wifi.print_terminal_qrs([{"ip": "192.168.1.24", "alias": "Wi-Fi"}], 18765)
    output = capsys.readouterr().out
    assert "http://192.168.1.24:18765/" in output
    assert output.count("\n") > 5


def test_lan_connect_page_sanitizes_addresses_and_renders_offline_qr(monkeypatch, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text('<html lang="ru">AGRO RADAR DEMO</html>', encoding="utf-8")
    (dist / "assets" / "bundle.js").write_text("window.AgroRadar=1", encoding="utf-8")
    monkeypatch.setenv("AGRORADAR_WIFI_PORT", "18765")
    monkeypatch.setenv("AGRORADAR_WIFI_IPS", "192.168.5.40;bad<script>;10.3.2.1;127.0.0.1;192.168.5.40")
    app = FastAPI()
    app.get("/api/sample")(lambda: {"source": "backend"})
    wifi_web.enable_wifi_site(app, dist_dir=dist)
    client = TestClient(app)
    assert "AGRO RADAR DEMO" in client.get("/").text
    assert "window.AgroRadar" in client.get("/assets/bundle.js").text
    assert client.get("/api/sample").json() == {"source": "backend"}
    assert client.get("/wifi/ping").json() == {"ready": True, "mode": "wifi_demo"}
    response = client.get("/wifi/connect")
    assert response.status_code == 200
    assert "http://192.168.5.40:18765/" in response.text
    assert "http://10.3.2.1:18765/" in response.text
    assert "bad&lt;script&gt;" not in response.text
    assert "http://127.0.0.1:18765/" not in response.text
    assert "data:image/svg+xml;base64," in response.text
    assert "Content-Security-Policy" in response.headers
    # Do not serve repo-side Python, .env, passwords or arbitrary filesystem paths.
    assert client.get("/backend/.env").status_code == 404
    assert client.get("/../../backend/app/auth.py").status_code == 404
    assert client.get("/assets/does-not-exist.js").status_code == 404


@pytest.mark.parametrize(("platform", "launcher"), [("darwin", "DEMO_WIFI.command"), ("win32", "DEMO_WIFI.bat")])
def test_connect_page_shows_the_launchers_for_this_system(monkeypatch, platform, launcher):
    monkeypatch.setattr(wifi_web.sys, "platform", platform)
    monkeypatch.delenv("AGRORADAR_WIFI_IPS", raising=False)
    page = wifi_web.connect_page(18765).body.decode()
    assert page.count(launcher) == 2


def test_missing_frontend_bundle_fails_loudly(monkeypatch, tmp_path):
    monkeypatch.setenv("AGRORADAR_WIFI_PORT", "18765")
    with pytest.raises(RuntimeError, match="frontend/dist"):
        wifi_web.enable_wifi_site(FastAPI(), dist_dir=tmp_path)


@pytest.mark.asyncio
@pytest.mark.real_auth
async def test_remote_viewer_can_use_app_but_admin_password_is_blocked(monkeypatch, tmp_path):
    monkeypatch.setenv("AGRORADAR_WIFI_DEMO", "1")
    monkeypatch.delenv("AGRORADAR_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    monkeypatch.setattr(auth, "PASSWORD_FILE", tmp_path / "admin_access.txt")
    monkeypatch.setattr(auth, "USERS_FILE", tmp_path / "viewer_accounts.json")
    monkeypatch.setattr(main, "CATALOG_FILE", tmp_path / "fields.json")
    monkeypatch.setattr(main, "GEOMETRY_FILE", tmp_path / "geometry.json")
    auth._SESSIONS.clear()
    auth._FAILED_LOGINS.clear()

    local = httpx.ASGITransport(app=main.app, client=("127.0.0.1", 5000))
    remote = httpx.ASGITransport(app=main.app, client=("192.168.2.35", 5001))
    password = auth.admin_password()

    async with httpx.AsyncClient(transport=local,base_url="http://127.0.0.1:18765") as admin:
        login = await admin.post("/api/auth/login", json={"username": "admin", "password": password})
        assert login.status_code == 200, login.text
        token = login.cookies.get("agroradar_session")
        csrf = login.json()["csrf_token"]
        assert token
        created = await admin.post("/api/auth/users", headers={"X-Agro-CSRF": csrf},
                                   json={"username": "judge01", "password": "temporary-judge-pass"})
        assert created.status_code == 201, created.text

    async with httpx.AsyncClient(transport=remote,base_url="http://192.168.2.12:18765") as phone:
        admin_from_phone = await phone.post("/api/auth/login", json={"username": "admin", "password": password})
        assert admin_from_phone.status_code == 403
        assert "ноутбука" in admin_from_phone.text
        # Forged Host header must not turn a LAN peer into a loopback client.
        spoof = await phone.post("/api/auth/login",
                                 headers={"Host": "127.0.0.1:18765"},
                                 json={"username": "admin", "password": password})
        assert spoof.status_code == 403
        assert (await phone.get("/api/fields")).status_code == 401
        viewer_login = await phone.post("/api/auth/login", json={"username": "judge01", "password": "temporary-judge-pass"})
        assert viewer_login.status_code == 200
        assert viewer_login.json()["role"] == "viewer"
        assert "httponly" in viewer_login.headers["set-cookie"].lower()
        assert "samesite=strict" in viewer_login.headers["set-cookie"].lower()
        assert (await phone.get("/api/fields")).status_code == 200
        assert (await phone.get("/api/dashboard")).status_code == 200
        assert (await phone.get("/api/fields.geojson")).status_code == 200
        assert (await phone.post("/api/fields",json={"name":"bad"},
                                 headers={"X-Agro-CSRF":viewer_login.json()["csrf_token"]})).status_code == 403
        assert (await phone.get("/api/admin/backup")).status_code == 403

        # Even if an admin's session cookie were replayed on a phone, admin API is denied.
        hijacked = await phone.get("/api/auth/users",
                                  headers={"Cookie": f"agroradar_session={token}"})
        assert hijacked.status_code == 403
