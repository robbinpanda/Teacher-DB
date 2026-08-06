@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title Teacher Question Bank

echo.
echo ========================================
echo   Teacher Question Bank
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 22.13 or newer, then run this file again.
  goto :failed
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js with npm included.
  goto :failed
)

for /f "delims=" %%V in ('node -p "process.versions.node"') do set "NODE_VERSION=%%V"
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major>22||(major===22&&minor>=13)?0:1)"
if errorlevel 1 (
  echo [ERROR] Node.js %NODE_VERSION% is installed, but version 22.13 or newer is required.
  goto :failed
)

if /i "%~1"=="--check" (
  echo [OK] Node.js %NODE_VERSION%
  echo [OK] npm is available
  echo [OK] Launcher check passed
  exit /b 0
)

powershell.exe -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3050/api/health' -TimeoutSec 2; if ($response.StatusCode -ge 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo [INFO] The app is already running. Opening the browser.
  start "" "http://localhost:3050"
  goto :finished
)

node -e "require('next/package.json');require('better-sqlite3');" >nul 2>nul
if errorlevel 1 (
  echo [SETUP] Installing project dependencies. Keep the network connected.
  echo.
  call npm.cmd ci
  if errorlevel 1 (
    echo.
    echo [ERROR] Dependency installation failed. Check the network and try again.
    goto :failed
  )
  echo.
  echo [OK] Project dependencies installed.
)

echo [START] http://localhost:3050
echo [INFO] The browser will open when the app is ready.
echo [INFO] Keep this window open. Close it to stop the app.
echo.

start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "$url='http://localhost:3050'; for($i=0;$i -lt 120;$i++){ try { $response=Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2; if($response.StatusCode -ge 200){ Start-Process $url; exit } } catch {}; Start-Sleep -Seconds 1 }"
call npm.cmd run dev

echo.
echo [INFO] The app has stopped.
goto :finished

:failed
echo.
pause
exit /b 1

:finished
echo.
pause
exit /b 0
