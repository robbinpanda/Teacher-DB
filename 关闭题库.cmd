@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Stop Teacher Question Bank
node scripts/stop-local.mjs %*
if errorlevel 1 (
  echo [ERROR] Stop failed. See the message above.
  if /i "%~1"=="--check" exit /b 1
  pause
  exit /b 1
)
if /i "%~1"=="--check" exit /b 0
pause
