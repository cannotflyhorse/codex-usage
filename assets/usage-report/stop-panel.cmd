@echo off
rem Stop the usage panel started by start-panel.cmd (only the process listening on 8787).
rem Keep this file ASCII-only so cmd.exe parses it correctly on any codepage.
setlocal
set "FOUND="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:"LISTENING" ^| findstr /c:"127.0.0.1:8787"') do (
  echo [STOP] stopping PID %%p
  taskkill /PID %%p /F >nul 2>nul
  powershell -NoProfile -Command "Stop-Process -Id %%p -Force -ErrorAction SilentlyContinue"
  set "FOUND=1"
)
if defined FOUND (
  echo [OK] panel stopped.
) else (
  echo [INFO] nothing listening on 127.0.0.1:8787
)
endlocal
