@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM ============================================================
REM  INTERRUTTORE UNICO SICUREZZA
REM  Un doppio clic: se e' spenta la ACCENDE (e apre Proton),
REM  se e' accesa la SPEGNE (torni alla navigazione normale).
REM ============================================================

REM --- auto-elevazione ad Amministratore ---
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cls
echo ============================================
echo   INTERRUTTORE SICUREZZA (Proton kill-switch)
echo ============================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0proton-killswitch.ps1" toggle
echo.
echo ============================================
echo   ATTENZIONE quando la sicurezza e' ACCESA:
echo   naviga solo con Proton connesso. Senza VPN,
echo   la rete resta bloccata (e' voluto).
echo   Riesegui questo file per spegnere/riaccendere.
echo ============================================
echo.
pause
endlocal
exit /b
