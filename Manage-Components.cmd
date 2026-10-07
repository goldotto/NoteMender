@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0runtime\node\node.exe" (
  "%~dp0runtime\node\node.exe" "%~dp0scripts\open-components.mjs"
) else (
  node.exe "%~dp0scripts\open-components.mjs"
)
if errorlevel 1 pause
