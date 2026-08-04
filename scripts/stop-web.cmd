@echo off
setlocal
cd /d "%~dp0.."
set "FOUND="
for /f %%P in ('powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 3050 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess"') do (
  set "FOUND=1"
  echo Stopping Teacher DB - PID %%P
  taskkill /PID %%P /T /F >nul
)
if not defined FOUND echo Teacher DB is not running.
