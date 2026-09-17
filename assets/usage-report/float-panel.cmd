@echo off
rem Launch the always-on-top floating usage window (no console window kept open).
rem Keep this file ASCII-only so cmd.exe parses it correctly on any codepage.
setlocal
cd /d "%~dp0"

set "PS=pwsh"
where pwsh >nul 2>nul
if errorlevel 1 (
  set "PS=powershell"
  where powershell >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Neither pwsh nor powershell found in PATH.
    pause
    exit /b 1
  )
)

start "" %PS% -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0float-panel.ps1"
echo [OK] Floating usage window started (look for the small panel at the top-right).
endlocal
