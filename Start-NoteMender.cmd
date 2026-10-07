@echo off
setlocal
cd /d "%~dp0"
set "NOTEMENDER_NODE=%~dp0runtime\node\node.exe"
if not exist "%NOTEMENDER_NODE%" set "NOTEMENDER_NODE=node.exe"
"%NOTEMENDER_NODE%" -e "process.exit(parseInt(process.versions.node,10)>=22?0:1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required. Extract the complete base package.
  pause
  exit /b 1
)
"%NOTEMENDER_NODE%" "%~dp0scripts\open-studio.mjs"
if errorlevel 1 pause
