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
