"""Local-first admin authentication for AgroRadar AI.

No third-party identity service. Password is kept out of Git, and sessions are
opaque, short-lived, HttpOnly cookies with CSRF protection for unsafe requests.
For any remote deployment, use HTTPS and enable secure cookies.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

COOKIE_NAME = "agroradar_session"
SESSION_SECONDS = 8 * 60 * 60
PASSWORD_FILE = Path(__file__).resolve().parents[1] / "data" / "admin_access.txt"
_LOCK = threading.RLock()
_SESSIONS: dict[str, tuple[float, str]] = {}
_FAILED_LOGINS: dict[str, list[float]] = {}
router = APIRouter(prefix="/api/auth", tags=["Доступ администратора"])


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=256)


def admin_password() -> str:
    """Use explicit environment credential, or generate a persistent local one."""
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
            raise RuntimeError(
                "Не удалось создать локальный пароль администратора. "
                "Проверь доступ к backend/data или установи AGRORADAR_ADMIN_PASSWORD."
            ) from exc


def authenticated_session(request: Request) -> tuple[str, str] | None:
    token = request.cookies.get(COOKIE_NAME, "")
    if not token:
        return None
    now = time.monotonic()
    with _LOCK:
        record = _SESSIONS.get(token)
        if not record:
            return None
        expires_at, csrf_token = record
        if now >= expires_at:
            _SESSIONS.pop(token, None)
            return None
        return token, csrf_token


def _check_login_limit(client_ip: str) -> None:
    now = time.monotonic()
    with _LOCK:
        attempts = [t for t in _FAILED_LOGINS.get(client_ip, []) if now - t < 300]
        _FAILED_LOGINS[client_ip] = attempts
        if len(attempts) >= 8:
            raise HTTPException(429, "Слишком много попыток входа. Повтори через 5 минут.")


@router.get("/status")
def status(request: Request):
    # Materialize the password before the login screen tells the user where it is.
    admin_password()
    session = authenticated_session(request)
    return {"authenticated": session is not None,
            "csrf_token": session[1] if session else None,
            "session_hours": SESSION_SECONDS // 3600}


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    _check_login_limit(ip)
    expected = admin_password()
    # Equal-length digests avoid obvious timing leaks while allowing long passwords.
    expected_hash = hashlib.sha256(expected.encode("utf-8")).digest()
    supplied_hash = hashlib.sha256(payload.password.encode("utf-8")).digest()
    if not secrets.compare_digest(expected_hash, supplied_hash):
        with _LOCK:
            _FAILED_LOGINS.setdefault(ip, []).append(time.monotonic())
        raise HTTPException(401, "Неверный пароль администратора.")
    with _LOCK:
        _FAILED_LOGINS.pop(ip, None)
        token, csrf_token = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        _SESSIONS[token] = (time.monotonic() + SESSION_SECONDS, csrf_token)
    response.set_cookie(
        key=COOKIE_NAME, value=token, max_age=SESSION_SECONDS,
        httponly=True, secure=os.getenv("AGRORADAR_SECURE_COOKIES", "") == "1",
        samesite="strict", path="/api",
    )
    return {"authenticated": True, "csrf_token": csrf_token}


@router.post("/logout")
def logout(request: Request, response: Response):
    session = authenticated_session(request)
    if session:
        with _LOCK:
            _SESSIONS.pop(session[0], None)
    response.delete_cookie(COOKIE_NAME, path="/api", samesite="strict")
    return {"authenticated": False}


async def auth_guard(request: Request, call_next):
    """Require a session on data/API routes and a CSRF header on mutations."""
    path = request.url.path
    is_protected = (path.startswith("/api/") and path not in (
        "/api/health", "/api/auth/login", "/api/auth/status",
    )) or path in ("/docs", "/redoc", "/openapi.json")
    if is_protected:
        session = authenticated_session(request)
        if session is None:
            return JSONResponse(status_code=401, content={"detail": "Требуется вход администратора."},
                                headers={"Cache-Control": "no-store"})
        if request.method.upper() not in ("GET", "HEAD", "OPTIONS"):
            provided = request.headers.get("X-Agro-CSRF", "")
            if not secrets.compare_digest(provided, session[1]):
                return JSONResponse(status_code=403,
                    content={"detail": "Неверный CSRF-токен. Обнови страницу и войди снова."},
                    headers={"Cache-Control": "no-store"})
    response = await call_next(request)
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response
