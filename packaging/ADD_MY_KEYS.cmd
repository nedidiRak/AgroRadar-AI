@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ADD_MY_KEYS.ps1"
echo.
pause
