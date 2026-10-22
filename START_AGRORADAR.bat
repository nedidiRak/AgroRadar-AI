@echo off
set "ROOT=%~dp0"
if not exist "%ROOT%backend\.venv\Scripts\python.exe" (
  echo Backend environment not found: backend\.venv
  echo Open PowerShell in backend and run: python -m venv .venv
  pause
  exit /b 1
)
if not exist "%ROOT%frontend\node_modules" (
  echo Frontend packages are missing. Open PowerShell in frontend and run: npm.cmd install
  pause
  exit /b 1
)
start "AgroRadar API" /D "%ROOT%backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --reload"
start "AgroRadar UI" /D "%ROOT%frontend" cmd /k "npm.cmd run dev"
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"
