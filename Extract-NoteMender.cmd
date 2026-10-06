@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Extract-NoteMender.ps1"
if errorlevel 1 pause
