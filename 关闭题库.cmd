@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title Stop Teacher Question Bank

echo.
echo ========================================
echo   Stop Teacher Question Bank
echo ========================================
echo.

set "APP_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":3050 .*LISTENING"') do if not defined APP_PID set "APP_PID=%%P"

if not defined APP_PID (
  echo [INFO] The app is not running on port 3050.
  if /i "%~1"=="--check" exit /b 0
  goto :finished
)

powershell.exe -NoProfile -Command "try { $response = Invoke-RestMethod -Uri 'http://localhost:3050/api/health' -TimeoutSec 3; if ($response.ok -eq $true -and $response.database.quickCheck -eq 'ok') { exit 0 } } catch {}; exit 1" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Port 3050 is used by another program ^(PID %APP_PID%^).
  echo [INFO] Nothing was stopped.
  if /i "%~1"=="--check" exit /b 1
  goto :failed
)

if /i "%~1"=="--check" (
  echo [OK] Teacher Question Bank is running ^(PID %APP_PID%^).
  echo [OK] Stop launcher check passed. No process was stopped.
  exit /b 0
)

echo [STOP] Stopping Teacher Question Bank ^(PID %APP_PID%^)...
taskkill /PID %APP_PID% /T /F >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Failed to stop the app. Try running this file as administrator.
  goto :failed
)

timeout /t 1 /nobreak >nul
netstat -ano | findstr /R /C:":3050 .*LISTENING" >nul
if not errorlevel 1 (
  echo [ERROR] Port 3050 is still in use. The app may not have stopped completely.
  goto :failed
)

echo [OK] Teacher Question Bank has stopped.
goto :finished

:failed
echo.
pause
exit /b 1

:finished
echo.
pause
exit /b 0
