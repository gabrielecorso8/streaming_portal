@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM --- auto-elevazione ad Amministratore ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Richiesta permessi di Amministratore...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

:menu
cls
echo ============================================
echo   PROTON KILL-SWITCH (Windows Firewall)
echo   Cartella: %~dp0
echo ============================================
echo.
echo   1  Attiva  (blocca tutto fuori dal tunnel)
echo   2  Disattiva (ripristina rete normale)
echo   3  Stato
echo   4  Esci
echo.
set "c="
set /p "c=Scegli e premi Invio: "
if "%c%"=="1" goto do_enable
if "%c%"=="2" goto do_disable
if "%c%"=="3" goto do_status
if "%c%"=="4" goto fine
echo Scelta non valida: "%c%"
timeout /t 2 >nul
goto menu

:do_enable
echo.
echo --- ATTIVAZIONE ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0proton-killswitch.ps1" enable
echo.
echo (fine comando - codice uscita %errorlevel%)
pause
goto menu

:do_disable
echo.
echo --- DISATTIVAZIONE ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0proton-killswitch.ps1" disable
echo.
pause
goto menu

:do_status
echo.
echo --- STATO ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0proton-killswitch.ps1" status
echo.
pause
goto menu

:fine
endlocal
exit /b
