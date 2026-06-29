@echo off
title SC Portal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul || set "PY=py"

echo ============================================
echo            Avvio di SC Portal
echo ============================================
echo Il primo avvio installa cio' che serve
echo (puo' richiedere qualche minuto). Attendere...
echo.

%PY% start.py

echo.
echo SC Portal e' stato chiuso.
pause >nul
