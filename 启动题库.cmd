@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title Teacher Question Bank

echo.
echo ========================================
echo   Teacher Question Bank
echo ========================================
echo.

set "REQUIRED_NODE_VERSION=22.22.0"
if exist ".nvmrc" set /p "REQUIRED_NODE_VERSION="<".nvmrc"

set "NVM_EXE="
if defined NVM_HOME if exist "%NVM_HOME%\nvm.exe" set "NVM_EXE=%NVM_HOME%\nvm.exe"
if not defined NVM_EXE for /f "delims=" %%N in ('where nvm.exe 2^>nul') do if not defined NVM_EXE set "NVM_EXE=%%N"

where node >nul 2>nul
if errorlevel 1 goto :activate_required_node

for /f "delims=" %%V in ('node -p "process.versions.node"') do set "NODE_VERSION=%%V"
if /i "%NODE_VERSION%"=="%REQUIRED_NODE_VERSION%" goto :node_ready

echo [SETUP] Node.js %NODE_VERSION% is active, but this project requires %REQUIRED_NODE_VERSION%.

:activate_required_node
if not defined NVM_EXE (
  echo [ERROR] Node.js %REQUIRED_NODE_VERSION% is required.
  echo Install Node.js %REQUIRED_NODE_VERSION%, or install NVM for Windows, then run this file again.
  goto :failed
)

:switch_node
echo [SETUP] Switching to Node.js %REQUIRED_NODE_VERSION% with NVM for Windows...
"%NVM_EXE%" use %REQUIRED_NODE_VERSION%
if errorlevel 1 (
  echo [SETUP] Node.js %REQUIRED_NODE_VERSION% is not installed. Installing it now...
  "%NVM_EXE%" install %REQUIRED_NODE_VERSION%
  if errorlevel 1 (
    echo [ERROR] Could not install Node.js %REQUIRED_NODE_VERSION%.
    goto :failed
  )
  "%NVM_EXE%" use %REQUIRED_NODE_VERSION%
  if errorlevel 1 (
    echo [ERROR] Could not activate Node.js %REQUIRED_NODE_VERSION%.
    goto :failed
  )
)

set "NODE_VERSION="
for /l %%R in (1,1,10) do if not defined NODE_VERSION call :detect_node_version
if not defined NODE_VERSION (
  echo [ERROR] Node.js is still unavailable after the NVM switch.
  goto :failed
)
if /i not "%NODE_VERSION%"=="%REQUIRED_NODE_VERSION%" (
  echo [ERROR] NVM reported success, but Node.js %NODE_VERSION% is still active.
  echo Check that NVM_SYMLINK is present in PATH, then run this file again.
  goto :failed
)

:node_ready
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall Node.js with npm included.
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

:detect_node_version
for /f "delims=" %%V in ('node -p "process.versions.node" 2^>nul') do set "NODE_VERSION=%%V"
if not defined NODE_VERSION ping 127.0.0.1 -n 2 >nul
exit /b 0
