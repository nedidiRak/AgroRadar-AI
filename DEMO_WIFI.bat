@echo off
setlocal EnableExtensions
chcp 65001 >nul
title AgroRadar AI - Wi-Fi Demo
set "ROOT=%~dp0"
set "PYTHON=%ROOT%backend\.venv\Scripts\python.exe"
cd /d "%ROOT%"

echo ===============================================================
echo   AgroRadar AI - DEMO WIFI
echo   Single-origin React + FastAPI, QR and secure viewer access
echo ===============================================================
echo.
if not exist "%PYTHON%" (
  echo [ERROR] backend\.venv\Scripts\python.exe is missing.
  echo First install the project dependencies described in README.md.
  echo The ordinary START_AGRORADAR.bat will not be changed.
  pause
  exit /b 1
)

rem Double-click launches CMD without the PowerShell profile that activates fnm.
rem Reuse the same Node 22 activation as START_AGRORADAR.bat.
where npm.cmd >nul 2>&1
if errorlevel 1 (
  where fnm >nul 2>&1
  if errorlevel 1 (
    echo [ERROR] Node.js/npm are not available in this CMD session.
    echo Install Node.js, or install fnm, and reopen the terminal.
    echo If fnm is installed: open PowerShell and run "fnm install 22".
    pause
    exit /b 1
  )
  echo [INFO] Activating fnm-managed Node.js 22 for Wi-Fi Demo...
  for /f "delims=" %%Z in ('fnm env --shell cmd') do call %%Z
  call fnm use 22
  if errorlevel 1 (
    echo [ERROR] Unable to activate Node.js 22 via fnm.
    echo Open PowerShell, run "fnm install 22", and retry.
    pause
    exit /b 1
  )
)
where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm.cmd is still missing after Node.js initialization.
  pause
  exit /b 1
)
where node.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node.exe is missing from PATH.
  pause
  exit /b 1
)
echo [OK] Node.js and npm are ready for Wi-Fi Demo.

"%PYTHON%" "%ROOT%backend\demo_wifi.py" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" (
  echo [ERROR] DEMO_WIFI finished with error %EXITCODE%.
  echo Please read the cause above and check README_WIFI.md.
) else (
  echo [INFO] Wi-Fi demonstration ended.
)
pause
exit /b %EXITCODE%
