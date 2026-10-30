@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Bootstrap.ps1" -Mode install
if errorlevel 1 pause
