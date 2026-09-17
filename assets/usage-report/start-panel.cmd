@echo off
rem Start the usage panel in the background (hidden window), log to logs\panel.log
rem Keep this file ASCII-only so cmd.exe parses it correctly on any codepage.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node not found in PATH. Install Node.js first.
  pause
  exit /b 1
)

if not exist "logs" mkdir "logs"

rem Reuse an already running instance instead of starting a second one.
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/api/meta' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 10 } } catch { exit 0 }"
if errorlevel 10 (
  echo [INFO] Panel already running at http://127.0.0.1:8787
  exit /b 0
)

wscript //nologo "%~dp0start-panel.vbs"

timeout /t 2 /nobreak >nul
echo [OK] Usage panel started in background: http://127.0.0.1:8787
echo      Log: %~dp0logs\panel.log
endlocal
