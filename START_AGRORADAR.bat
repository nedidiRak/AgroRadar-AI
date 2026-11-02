@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "PYTHON=%ROOT%backend\.venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo [ERROR] Python environment missing: backend\.venv
  echo Open terminal in backend and run: python -m venv .venv
  pause
  exit /b 1
)
if not exist "%ROOT%frontend\node_modules" (
  echo [ERROR] Frontend packages are missing.
  echo Open terminal in frontend and run: npm.cmd install
  pause
  exit /b 1
)

set "AGRO_PORT="
pushd "%ROOT%backend"
for /f %%P in ('.venv\Scripts\python.exe select_port.py') do set "AGRO_PORT=%%P"
popd
if not defined AGRO_PORT (
  echo [ERROR] No available local port found for backend.
  echo Check Windows firewall, antivirus and excluded port ranges.
  pause
  exit /b 1
)

echo %AGRO_PORT%>"%ROOT%frontend\.agroradar-api-port"
echo AgroRadar backend: http://127.0.0.1:%AGRO_PORT%
echo AgroRadar frontend: http://localhost:5173

start "AgroRadar API" /D "%ROOT%backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port %AGRO_PORT% --reload"
start "AgroRadar UI" /D "%ROOT%frontend" cmd /k "npm.cmd run dev"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
endlocal
