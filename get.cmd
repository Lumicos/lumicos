@echo off
REM One-liner helper: fetch and run install.ps1 from the public main branch.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Lumicos/lumicos/main/install.ps1 | iex"
if errorlevel 1 pause
