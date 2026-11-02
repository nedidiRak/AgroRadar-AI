"""Local-first authentication with administrator and read-only AI viewers.

Admin access retains the existing backend/data/admin_access.txt password.
Viewer passwords are salted PBKDF2 hashes in a local, Git-ignored JSON file.
All sessions are HttpOnly cookies, with CSRF checks on state-changing requests.
For public deployment: HTTPS, secure cookies, persistent session storage, audit
logs and a database with multi-process transaction guarantees are required.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from .backups import preserve_previous
from pydantic import BaseModel, Field

COOKIE_NAME = "agroradar_session"
SESSION_SECONDS = 8 * 60 * 60
HASH_ITERATIONS = 260_000
PASSWORD_FILE = Path(__file__).resolve().parents[1] / "data" / "admin_access.txt"
USERS_FILE = Path(__file__).resolve().parents[1] / "data" / "viewer_accounts.json"

_LOCK = threading.RLock()
# opaque cookie token -> (expiry, csrf, username, immutable account id)
_SESSIONS: dict[str, tuple[float, str, str, str]] = {}
_FAILED_LOGINS: dict[str, list[float]] = {}
router = APIRouter(prefix="/api/auth", tags=["Авторизация и роли"])


class LoginRequest(BaseModel):
    # Default keeps the original administrator password-only clients functional.
    username: str = Field(default="admin", min_length=1, max_length=32)
    password: str = Field(min_length=1, max_length=256)


class ViewerCreate(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=10, max_length=128)


class ViewerPasswordUpdate(BaseModel):
    password: str = Field(min_length=10, max_length=128)


def admin_password() -> str:
    """Preserve legacy password generation and .env override unchanged."""
    configured = os.getenv("AGRORADAR_ADMIN_PASSWORD", "").strip()
    if configured:
        return configured
    with _LOCK:
        try:
            if PASSWORD_FILE.exists():
                password = PASSWORD_FILE.read_text(encoding="utf-8").strip()
                if len(password) < 20:
                    raise RuntimeError("Пароль администратора в файле слишком короткий.")
                return password
            PASSWORD_FILE.parent.mkdir(parents=True, exist_ok=True)
            password = secrets.token_urlsafe(24)
            try:
                fd = os.open(PASSWORD_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                return PASSWORD_FILE.read_text(encoding="utf-8").strip()
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(password + "\n")
            return password
        except OSError as exc:
            raise RuntimeError("Не удалось создать пароль. Проверь backend/data или AGRORADAR_ADMIN_PASSWORD.") from exc


def _read_viewers() -> dict[str, dict]:
    """Never overwrite an invalid or corrupted account store."""
    if not USERS_FILE.exists():
        return {}
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(500, "Файл пользователей недоступен или повреждён. Восстанови резервную копию.") from exc
    users = data.get("users") if isinstance(data, dict) else None
    if not isinstance(users, dict) or not all(isinstance(v, dict) for v in users.values()):
        raise HTTPException(500, "Неверный формат хранилища пользователей.")
    return users


def _save_viewers(users: dict[str, dict]) -> None:
    USERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    preserve_previous(USERS_FILE)
    temporary = USERS_FILE.with_name(USERS_FILE.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"version": 1, "users": users}, handle, ensure_ascii=False, indent=2)
        temporary.replace(USERS_FILE)
    finally:
        temporary.unlink(missing_ok=True)


def _username(value: str) -> str:
    username = value.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_.-]{2,31}", username):
        raise HTTPException(422, "Логин: 3–32 символа, латиница, цифры, точка, дефис или подчёркивание; начинается с буквы.")
    if username == "admin":
        raise HTTPException(409, "Имя admin зарезервировано.")
    return username


def _new_verifier(password: str) -> dict:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, HASH_ITERATIONS)
    return {"salt": salt.hex(), "hash": digest.hex(), "iterations": HASH_ITERATIONS}


def _verify_viewer(password: str, record: dict) -> bool:
    try:
        salt = bytes.fromhex(record["salt"])
        expected = bytes.fromhex(record["hash"])
        count = int(record["iterations"])
        if len(salt) < 16 or len(expected) != 32 or not 100_000 <= count <= 1_000_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, count)
        return secrets.compare_digest(actual, expected)
    except (KeyError, TypeError, ValueError):
        return False


def authenticated_session(request: Request) -> tuple[str, str] | None:
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        return None
    with _LOCK:
        record = _SESSIONS.get(token)
        if record is None:
            return None
        expires_at, csrf_token, username, account_id = record
        if time.monotonic() >= expires_at:
            _SESSIONS.pop(token, None)
            return None
        if username != "admin":
            user = _read_viewers().get(username)
            if not user or user.get("id") != account_id:
                _SESSIONS.pop(token, None)
                return None
        return token, csrf_token


def session_principal(session: tuple[str, str]) -> dict | None:
    with _LOCK:
        record = _SESSIONS.get(session[0])
        if not record:
            return None
        username = record[2]
        return {"username": username, "role": "admin" if username == "admin" else "viewer"}


def _check_login_limit(client_ip: str) -> None:
    now = time.monotonic()
    with _LOCK:
        attempts = [t for t in _FAILED_LOGINS.get(client_ip, []) if now - t < 300]
        _FAILED_LOGINS[client_ip] = attempts
        if len(attempts) >= 8:
            raise HTTPException(429, "Слишком много попыток входа. Повтори через 5 минут.")


@router.get("/status")
def auth_status(request: Request):
    admin_password()  # preserve automatic administrator password initialization
    session = authenticated_session(request)
    principal = session_principal(session) if session else None
    return {"authenticated": principal is not None, "csrf_token": session[1] if principal else None,
            "username": principal["username"] if principal else None,
            "role": principal["role"] if principal else None,
            "session_hours": SESSION_SECONDS // 3600}


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    _check_login_limit(ip)
    username = payload.username.strip().lower()
    account_id = "admin"
    if username == "admin":
        expected = hashlib.sha256(admin_password().encode("utf-8")).digest()
        supplied = hashlib.sha256(payload.password.encode("utf-8")).digest()
        valid = secrets.compare_digest(expected, supplied)
    else:
        with _LOCK:
            record = _read_viewers().get(username)
        valid = _verify_viewer(payload.password, record) if record else False
        if valid:
            account_id = record["id"]
    if not valid:
        with _LOCK:
            _FAILED_LOGINS.setdefault(ip, []).append(time.monotonic())
        raise HTTPException(401, "Неверный логин или пароль.")
    with _LOCK:
        _FAILED_LOGINS.pop(ip, None)
        token, csrf_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        _SESSIONS[token] = (time.monotonic() + SESSION_SECONDS, csrf_token, username, account_id)
    response.set_cookie(key=COOKIE_NAME, value=token, max_age=SESSION_SECONDS,
                        httponly=True, secure=os.getenv("AGRORADAR_SECURE_COOKIES", "") == "1",
                        samesite="strict", path="/api")
    return {"authenticated": True, "csrf_token": csrf_token,
            "username": username, "role": "admin" if username == "admin" else "viewer"}


@router.post("/logout")
def logout(request: Request, response: Response):
    session = authenticated_session(request)
    if session:
        with _LOCK:
            _SESSIONS.pop(session[0], None)
    response.delete_cookie(COOKIE_NAME, path="/api", samesite="strict")
    return {"authenticated": False}


@router.get("/users")
def list_users():
    with _LOCK:
        viewers = _read_viewers()
        return {"users": [
            {"username": name, "role": "viewer", "created_at": details.get("created_at")}
            for name, details in sorted(viewers.items())
        ]}


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(payload: ViewerCreate):
    username = _username(payload.username)
    with _LOCK:
        viewers = _read_viewers()
        if username in viewers:
            raise HTTPException(409, "Пользователь с таким логином уже существует.")
        if len(viewers) >= 100:
            raise HTTPException(422, "Достигнут лимит 100 пользователей.")
        record = {"id": uuid.uuid4().hex, "created_at": datetime.now(timezone.utc).isoformat(),
                  **_new_verifier(payload.password)}
        viewers[username] = record
        _save_viewers(viewers)
        return {"created": True, "user": {"username": username, "role": "viewer",
                "created_at": record["created_at"]}}


def _revoke_user_sessions(username: str) -> None:
    for token, record in list(_SESSIONS.items()):
        if record[2] == username:
            _SESSIONS.pop(token, None)


@router.put("/users/{username}/password")
def update_user_password(username: str, payload: ViewerPasswordUpdate):
    username = _username(username)
    with _LOCK:
        viewers = _read_viewers()
        if username not in viewers:
            raise HTTPException(404, "Пользователь не найден.")
        viewers[username].update(_new_verifier(payload.password))
        _save_viewers(viewers)
        _revoke_user_sessions(username)
    return {"updated": True, "username": username, "sessions_revoked": True}


@router.delete("/users/{username}")
def delete_user(username: str):
    username = _username(username)
    with _LOCK:
        viewers = _read_viewers()
        if username not in viewers:
            raise HTTPException(404, "Пользователь не найден.")
        viewers.pop(username)
        _save_viewers(viewers)
        _revoke_user_sessions(username)
    return {"deleted": True, "username": username, "sessions_revoked": True}


async def auth_guard(request: Request, call_next):
    """Server-enforced RBAC: viewer can GET data and POST AI chat/logout only."""
    path = request.url.path
    protected = (path.startswith("/api/") and path not in (
        "/api/health", "/api/auth/login", "/api/auth/status",
    )) or path in ("/docs", "/redoc", "/openapi.json")
    if protected:
        session = authenticated_session(request)
        principal = session_principal(session) if session else None
        if principal is None:
            return JSONResponse(status_code=401, content={"detail": "Требуется вход в AgroRadar AI."},
                                headers={"Cache-Control": "no-store"})
        role = principal["role"]
        if (path.startswith("/api/auth/users") or path.startswith("/api/admin/") or path == "/api/operations/activity" or path in ("/docs", "/redoc", "/openapi.json")) and role != "admin":
            return JSONResponse(status_code=403, content={"detail": "Доступ только для администратора."},
                                headers={"Cache-Control": "no-store"})
        if request.method.upper() not in ("GET", "HEAD", "OPTIONS"):
            provided = request.headers.get("X-Agro-CSRF", "")
            if not secrets.compare_digest(provided, session[1]):
                return JSONResponse(status_code=403,
                    content={"detail": "Неверный CSRF-токен. Обнови страницу и войди снова."},
                    headers={"Cache-Control": "no-store"})
            if role == "viewer" and not (
                request.method.upper() == "POST" and path in ("/api/ai/chat", "/api/auth/logout")
            ):
                return JSONResponse(status_code=403,
                    content={"detail": "Роль «Наблюдатель»: разрешены просмотр и диалог с ИИ, изменение данных запрещено."},
                    headers={"Cache-Control": "no-store"})
        request.state.agro_user = principal
    response = await call_next(request)
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response
