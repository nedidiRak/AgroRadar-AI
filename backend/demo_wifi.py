"""One-command Windows LAN demo launcher for AgroRadar AI.

Builds frontend/dist, discovers IPv4 adapters, selects an unrestricted wildcard
port, optionally requests a Private/LocalSubnet Windows Firewall rule, and runs
a single-origin FastAPI server. START_AGRORADAR.bat is untouched.
"""
from __future__ import annotations

import argparse
import base64
import importlib.util
import ipaddress
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"
RULE_NAME = "AgroRadar AI WiFi Demo (Private LAN only)"
PORT_CANDIDATES = (18765, 18080, 19080, 28080, 38080, 8765, 8010, 8001)
VIRTUAL_WORDS = ("wsl", "virtualbox", "vmware", "vEthernet", "hyper-v", "tailscale",
                 "wireguard", "zerotier", "docker", "loopback", "openvpn", "tap-windows",
                 "nordvpn", "protonvpn")


def _powershell(script: str, *, timeout: int = 16) -> subprocess.CompletedProcess:
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        capture_output=True, text=True, errors="replace", timeout=timeout,
    )


def valid_lan_ip(value: str) -> bool:
    try:
        address = ipaddress.IPv4Address(value.strip())
        return (not address.is_loopback and not address.is_link_local and
                not address.is_multicast and not address.is_unspecified and
                (address.is_private or address in ipaddress.IPv4Network("100.64.0.0/10")))
    except ipaddress.AddressValueError:
        return False


def discover_ipv4() -> list[dict[str, str]]:
    """Only active IPv4 adapters; prefer Wi-Fi and gateway-backed interfaces.

    The network category is advisory: Public Wi-Fi won't accept our Private
    firewall rule. Avoid probing / scanning other devices.
    """
    found: list[dict[str, str]] = []
    if sys.platform == "win32":
        script = r"""
$ErrorActionPreference = 'SilentlyContinue'
$result = @(
  Get-NetIPConfiguration | Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' } |
  ForEach-Object {
    $adapter = $_
    $profile = Get-NetConnectionProfile -InterfaceIndex $adapter.InterfaceIndex
    foreach ($addr in @($adapter.IPv4Address)) {
      [PSCustomObject]@{
        ip = [string]$addr.IPAddress
        alias = [string]$adapter.InterfaceAlias
        gateway = [string]($adapter.IPv4DefaultGateway.NextHop | Select-Object -First 1)
        profile = [string]($profile.NetworkCategory | Select-Object -First 1)
      }
    }
  }
)
ConvertTo-Json -InputObject $result -Depth 4 -Compress
"""
        try:
            result = _powershell(script)
            data = json.loads(result.stdout) if result.returncode == 0 and result.stdout.strip() else []
            if isinstance(data, dict):
                data = [data]
            for row in data if isinstance(data, list) else []:
                if isinstance(row, dict):
                    ip = str(row.get("ip") or "")
                    if valid_lan_ip(ip):
                        found.append({
                            "ip": ip,
                            "alias": str(row.get("alias") or "Сетевой адаптер"),
                            "gateway": str(row.get("gateway") or ""),
                            "profile": str(row.get("profile") or "Unknown"),
                        })
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
            pass

    # Fallback is useful for systems whose PowerShell network cmdlets are blocked.
    if not found:
        guesses: set[str] = set()
        try:
            for record in socket.getaddrinfo(socket.gethostname(), None, family=socket.AF_INET):
                guesses.add(record[4][0])
        except OSError:
            pass
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                probe.connect(("1.1.1.1", 53))  # UDP connect only; no packets sent.
                guesses.add(probe.getsockname()[0])
            finally:
                probe.close()
        except OSError:
            pass
        for address in guesses:
            if valid_lan_ip(address):
                found.append({"ip": address, "alias": "Обнаруженный IPv4", "gateway": "", "profile": "Unknown"})
    unique: dict[str, dict[str, str]] = {}
    for entry in found:
        unique.setdefault(entry["ip"], entry)

    def preference(entry: dict[str, str]) -> tuple[int, int, int, str]:
        name = entry["alias"].lower()
        physical = not any(word.lower() in name for word in VIRTUAL_WORDS)
        wireless = any(word in name for word in ("wi-fi", "wifi", "wireless", "wlan", "беспровод"))
        return (0 if physical and wireless else 1 if physical else 2,
                0 if entry["gateway"] else 1,
                0 if entry["profile"].lower() == "private" else 1,
                entry["ip"])

    return sorted(unique.values(), key=preference)


def choose_port(preferred: int | None = None) -> int:
    values = (preferred,) if preferred is not None else PORT_CANDIDATES
    for port in values:
        if port is None or not 1024 <= port <= 65535:
            continue
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                if sys.platform == "win32" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                    listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                listener.bind(("0.0.0.0", port))  # IMPORTANT: wildcard, not loopback.
                return port
        except OSError:
            continue
    raise RuntimeError(
        "Windows не разрешает открывать ни один из демонстрационных портов. "
        "Проверь зарезервированные порты и правила безопасности, либо укажи --port."
    )


def build_frontend() -> None:
    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if not npm:
        raise RuntimeError("Не найден Node.js/npm. Установи Node.js и повтори запуск.")
    if not (FRONTEND / "node_modules").is_dir():
        print("[INSTALL] Устанавливаю frontend зависимости через npm ci...", flush=True)
        subprocess.run([npm, "ci"], cwd=FRONTEND, check=True)
    print("[BUILD] Собираю актуальную мобильную версию React...", flush=True)
    subprocess.run([npm, "run", "build"], cwd=FRONTEND, check=True)
    if not (FRONTEND / "dist" / "index.html").is_file():
        raise RuntimeError("Сборка завершилась, но frontend/dist/index.html отсутствует.")


def optional_qr_support() -> bool:
    if importlib.util.find_spec("qrcode"):
        return True
    print("[QR] Устанавливаю офлайн-генератор QR-кодов...", flush=True)
    try:
        outcome = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--disable-pip-version-check",
             "--retries", "1", "--timeout", "8", "qrcode>=7.4,<9"],
            timeout=55, check=False,
        )
        importlib.invalidate_caches()
        return outcome.returncode == 0 and importlib.util.find_spec("qrcode") is not None
    except (OSError, subprocess.TimeoutExpired):
        print("[QR] Нет доступа к установке. Адреса будут доступны без QR-кодов.")
        return False


def firewall_rule_active(port: int) -> bool:
    if sys.platform != "win32":
        return True
    name = RULE_NAME.replace("'", "''")
    query = f"""
$rules = @(Get-NetFirewallRule -DisplayName '{name}' -ErrorAction SilentlyContinue |
           Where-Object {{ $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' }})
foreach ($rule in $rules) {{
  $ports = $rule | Get-NetFirewallPortFilter
  $addresses = $rule | Get-NetFirewallAddressFilter
  if ($ports.LocalPort -eq '{port}' -and $addresses.RemoteAddress -contains 'LocalSubnet') {{
    Write-Output 'MATCH'
  }}
}}
"""
    try:
        result = _powershell(query, timeout=12)
        return result.returncode == 0 and "MATCH" in result.stdout
    except (OSError, subprocess.TimeoutExpired):
        return False


def setup_firewall_rule(port: int) -> bool:
    """Ask for user approval and UAC; never open Public/Internet traffic."""
    if sys.platform != "win32" or firewall_rule_active(port):
        return True
    print("\n[FIREWALL] Для доступа с телефонов нужен входящий порт "
          f"{port} в ЧАСТНОЙ локальной сети.")
    print("[FIREWALL] Будет создано правило только для этого Python, "
          "с профилем Private и удалёнными адресами LocalSubnet.")
    try:
        answer = input("Разрешить настройку через запрос Windows UAC? [Y/N]: ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = ""
    if answer not in ("y", "yes", "д", "да"):
        print("[FIREWALL] Правило не создавалось. Телефоны могут не подключиться.")
        return False
    python = str(Path(sys.executable).resolve()).replace("'", "''")
    name = RULE_NAME.replace("'", "''")
    inner = f"""
$ErrorActionPreference = 'Stop'
Get-NetFirewallRule -DisplayName '{name}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName '{name}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort {port} -Program '{python}' -Profile Private -RemoteAddress LocalSubnet -Enabled True | Out-Null
"""
    payload = base64.b64encode(inner.encode("utf-16-le")).decode("ascii")
    outer = (
        "$process = Start-Process -FilePath 'powershell.exe' "
        f"-ArgumentList '-NoProfile -NonInteractive -EncodedCommand {payload}' "
        "-Verb RunAs -Wait -PassThru; "
        "if ($process) { exit $process.ExitCode } else { exit 1 }"
    )
    try:
        result = _powershell(outer, timeout=65)
        if result.returncode == 0 and firewall_rule_active(port):
            print("[FIREWALL] Разрешён вход с локальной подсети в профиле Private.")
            return True
        print("[FIREWALL] Не удалось подтвердить правило. "
              "Проверь UAC, политику Windows и профиль Wi-Fi.")
    except (OSError, subprocess.TimeoutExpired):
        print("[FIREWALL] Запрос разрешения не завершён. "
              "Проверь настройки вручную.")
    return False


def _ready(port: int, process: subprocess.Popen, max_wait: float = 25.0) -> bool:
    url = f"http://127.0.0.1:{port}/wifi/ping"
    deadline = time.monotonic() + max_wait
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=1.5) as response:
                if response.status == 200 and json.load(response).get("mode") == "wifi_demo":
                    return True
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.45)
    return False


def launch(preferred_port: int | None, addresses: list[dict[str, str]]) -> int:
    build_frontend()
    qr_installed = optional_qr_support()
    port_candidates = (preferred_port,) if preferred_port is not None else PORT_CANDIDATES
    port_candidates = [p for p in port_candidates if p is not None]
    for wanted in port_candidates:
        try:
            port = choose_port(wanted)
        except RuntimeError:
            continue
        print(f"\n[PORT] Выбран TCP {port}; проверено связывание 0.0.0.0:{port}.")
        setup_firewall_rule(port)
        env = dict(os.environ)
        env["AGRORADAR_WIFI_DEMO"] = "1"
        env["AGRORADAR_WIFI_PORT"] = str(port)
        env["AGRORADAR_WIFI_IPS"] = ";".join(item["ip"] for item in addresses)
        env["AGRORADAR_SECURE_COOKIES"] = "0"  # override .env for LAN HTTP (Secure cookies cannot be sent)
        command = [sys.executable, "-m", "uvicorn", "app.main:app",
                   "--host", "0.0.0.0", "--port", str(port), "--no-access-log"]
        print("[SERVER] Запускаю FastAPI и React в одном процессе...", flush=True)
        process = subprocess.Popen(command, cwd=BACKEND, env=env)
        if not _ready(port, process):
            print(f"[PORT] Сервер не запустился на {port}; проверяю следующий порт.")
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            continue

        print("\n" + "=" * 67)
        print("  AgroRadar AI — Wi-Fi демонстрация готова!")
        print("=" * 67)
        print(f"  На ноутбуке (admin): http://127.0.0.1:{port}/")
        print(f"  QR-коды и инструкции: http://127.0.0.1:{port}/wifi/connect")
        for item in addresses:
            label = item["alias"]
            print(f"  Телефон (viewer): http://{item['ip']}:{port}/  [{label}]")
        if not qr_installed:
            print("  [QR] QR отсутствует; используй адрес из строки выше.")
        print("  Важно: телефон и ноутбук должны быть в одной сети без client isolation.")
        print("  ВАЖНО: администратор с телефонов входить не может, используй viewer.")
        print("  Закрой это окно (Ctrl+C), чтобы завершить демонстрацию.")
        print("=" * 67 + "\n", flush=True)
        webbrowser.open(f"http://127.0.0.1:{port}/wifi/connect")
        try:
            return process.wait()
        except KeyboardInterrupt:
            print("\n[STOP] Завершаю Wi-Fi демонстрацию...", flush=True)
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            return 0
    raise RuntimeError("Не удалось запустить Wi-Fi сервер ни на одном доступном порту. "
                       "Возможно, Windows/антивирус блокирует внешний bind.")


def main() -> int:
    parser = argparse.ArgumentParser(description="AgroRadar AI secure Wi-Fi demo")
    parser.add_argument("--port", type=int, help="Фиксированный LAN порт, если разрешён Windows")
    parser.add_argument("--ip", help="Вручную указать IPv4 подключённого Wi-Fi адаптера")
    options = parser.parse_args()
    print("AgroRadar AI | Режим демонстрации по Wi-Fi", flush=True)
    print("Этот режим использует HTTP только в доверенной локальной сети.")
    if options.ip:
        if not valid_lan_ip(options.ip):
            raise RuntimeError("Укажи локальный IPv4 (например 192.168.1.50), не публичный адрес.")
        addresses = [{"ip": options.ip, "alias": "Адрес, выбранный вручную",
                      "gateway": "", "profile": "Unknown"}]
    else:
        addresses = discover_ipv4()
    if not addresses:
        raise RuntimeError(
            "Не найден адрес IPv4 активного Wi-Fi/Ethernet. Подключись к сети и "
            "повтори запуск или укажи DEMO_WIFI.bat --ip 192.168.1.50."
        )
    print("\n[NETWORK] Обнаружены локальные адреса:")
    for item in addresses:
        print(f"  {item['ip']:<17} {item['alias']}  "
              f"[профиль: {item['profile']}, gateway: {item['gateway'] or '—'}]")
    if sys.platform == "win32" and not any(
        entry["profile"].lower() == "private" for entry in addresses
    ):
        print("\n[WARNING] Windows может считать Wi-Fi общедоступным (Public). "
              "Наша безопасная firewall-настройка работает только для Private. "
              "Для ДОВЕРЕННОЙ сети настрой профиль «Частная» в параметрах Windows.")
    return launch(options.port, addresses)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.CalledProcessError, OSError) as exc:
        print(f"\n[ERROR] {exc}", flush=True)
        sys.exit(1)
