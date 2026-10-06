@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Download-Release-Parts.ps1" -Edition gpu
if errorlevel 1 pause
