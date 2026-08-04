@echo off
setlocal
cd /d "%~dp0.."
if not exist ".runtime" mkdir ".runtime"
for /f %%P in ('powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 3050 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess"') do (
  echo Teacher DB is already running at http://localhost:3050 - PID %%P
  exit /b 0
)
start "Teacher DB" /b cmd.exe /d /c "npm.cmd run start 1^> .runtime\server.log 2^>^&1"
echo Starting Teacher DB at http://localhost:3050
echo Log: %CD%\.runtime\server.log
