@echo off
rem Run the usage panel in the foreground (keeps a console window open, Ctrl+C to stop).
rem Useful when the hidden launcher cannot start, e.g. inside a restricted shell.
rem Keep this file ASCII-only so cmd.exe parses it correctly on any codepage.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH. Install Node.js first.
  pause
  exit /b 1
)

echo [OK] Starting usage panel on http://127.0.0.1:8787 (Ctrl+C to stop)
node server.js
pause
endlocal
