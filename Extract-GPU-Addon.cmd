@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Extract-NoteMender.ps1" -ManifestFile gpu-manifest.json -Destination "%~dp0NoteMender-GPU-v2.5.0-demo.7"
if errorlevel 1 pause
