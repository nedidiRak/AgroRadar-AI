@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0frontend"
if errorlevel 1 (
  echo Could not open frontend directory.
  pause
  exit /b 1
)
echo Installing Markdown renderer for AgroRadar AI...
call npm.cmd install react-markdown@9.1.0 remark-gfm@4.0.1
if errorlevel 1 (
  echo.
  echo ERROR: npm installation failed. Check internet connection and npm output.
  pause
  exit /b 1
)
echo.
echo Success. Restart Vite: npm.cmd run dev
pause
