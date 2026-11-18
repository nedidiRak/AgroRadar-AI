@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "PYTHON=%ROOT%backend\.venv\Scripts\python.exe"

if not exist "%PYTHON%" (
  echo [ERROR] Python environment missing: backend\.venv
  echo Open terminal in backend and run: py -3.12 -m venv .venv
  pause
  exit /b 1
)

rem GitHub Desktop / Explorer starts this batch in CMD, not PowerShell.
rem fnm may be installed, but its Node.js is not on CMD's PATH yet.
where npm.cmd >nul 2>&1
if errorlevel 1 (
  where fnm >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] npm.cmd was not found and fnm is not available.
    echo Install Node.js or add fnm to PATH, then restart Explorer.
    pause
    exit /b 1
  )

  echo [INFO] npm.cmd not found. Activating Node.js 22 via fnm...
  for /f "delims=" %%Z in ('fnm env --shell cmd') do call %%Z
  fnm use 22
  if errorlevel 1 (
    echo [ERROR] Could not activate Node.js 22 with fnm.
    echo Run in PowerShell: fnm install 22
    pause
    exit /b 1
  )
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm.cmd is still unavailable after Node.js setup.
  pause
  exit /b 1
)
node --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe is not available on PATH.
  pause
  exit /b 1
)
echo [OK] Node.js and npm.cmd are available.

if not exist "%ROOT%frontend\node_modules" (
  echo [ERROR] Frontend packages are missing.
  echo Open PowerShell in frontend and run: npm.cmd ci
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
echo [SECURITY] On first start: admin password saved to backend\data\admin_access.txt
echo [SECURITY] Never share the contents of that file or upload it to GitHub.

start "AgroRadar API" /D "%ROOT%backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port %AGRO_PORT% --reload"
start "AgroRadar UI" /D "%ROOT%frontend" cmd /k "npm.cmd run dev"
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
endlocal
