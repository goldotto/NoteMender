@echo off
cd /d "%~dp0"
if exist "%~dp0runtime\portable-ready.json" goto offline
set "JIANPU_NODE=%~dp0runtime\node\node.exe"
if exist "%JIANPU_NODE%" (
  "%JIANPU_NODE%" -e "process.exit(parseInt(process.versions.node,10)>=22?0:1)"
  if not errorlevel 1 goto run_local
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Run the environment download script first.
  pause
  exit /b 1
)
set "JIANPU_NODE=node"
"%JIANPU_NODE%" -e "process.exit(parseInt(process.versions.node,10)>=22?0:1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required. Run the environment download script first.
  pause
  exit /b 1
)
goto run_local
:offline
set "JIANPU_NODE=%~dp0runtime\node\node.exe"
if not exist "%JIANPU_NODE%" goto incomplete
if not exist "%~dp0runtime\python\python.exe" goto incomplete
if not exist "%~dp0runtime\models\hub\checkpoints\955717e8-8726e21a.th" goto incomplete
"%~dp0runtime\python\python.exe" -c "import av, librosa, numpy, soundfile, torch, torchaudio, demucs"
if errorlevel 1 (
  echo Bundled Python audio environment could not start. Check the extracted files and Windows x64 compatibility.
  pause
  exit /b 1
)
goto run_local
:incomplete
echo The offline package is incomplete. Extract the entire ZIP to a normal folder and try again.
pause
exit /b 1
:run_local
"%JIANPU_NODE%" scripts/open-studio.mjs
if errorlevel 1 pause
