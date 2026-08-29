@echo off
REM ============================================================
REM  Proton Kill-Switch - menu con auto-elevazione Amministratore
REM  Richiama proton-killswitch.ps1 nella stessa cartella.
REM ============================================================
setlocal
cd /d "%~dp0"

REM --- auto-elevazione ad Amministratore ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Richiesta elevazione ad Amministratore...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

:menu
cls
echo ============================================
echo   PROTON KILL-SWITCH (Windows Firewall)
echo ============================================
echo   1  Attiva  (blocca tutto fuori dal tunnel)
echo   2  Disattiva (ripristina rete normale)
echo   3  Stato
echo   4  Esci
echo.
set "c="
set /p c=Scelta:
if "%c%"=="1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0proton-killswitch.ps1" enable
  echo. & pause & goto menu
)
if "%c%"=="2" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0proton-killswitch.ps1" disable
  echo. & pause & goto menu
)
if "%c%"=="3" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0proton-killswitch.ps1" status
  echo. & pause & goto menu
)
if "%c%"=="4" exit /b
goto menu
