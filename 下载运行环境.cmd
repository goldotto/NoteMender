@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-runtime.ps1" %*
if errorlevel 1 (
  echo Environment setup failed. See the error above and rerun this script.
  pause
  exit /b 1
)
echo Environment setup completed.
pause
