@echo off
rem Starts the harness's web app and opens it in your browser. Double-click to run.
rem Leave this window open while you use the app; close it (or press Ctrl+C) to stop.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js isn't installed or isn't on your PATH. Get version 20 or later from https://nodejs.org/
  pause
  exit /b 1
)
node scripts\serve.js --open
pause
