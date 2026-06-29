@echo off
title Crea EXE - SC Portal
cd /d "%~dp0"

set "PY=python"
where python >nul 2>nul || set "PY=py"

echo ============================================================
echo   Creazione dell'eseguibile SC Portal.exe
echo   (serve Python; questo passaggio lo fai TU una volta sola)
echo ============================================================
echo.
echo [1/2] Installo PyInstaller e le dipendenze...
%PY% -m pip install --upgrade pip
%PY% -m pip install pyinstaller -r requirements.txt
if errorlevel 1 goto err

echo.
echo [2/2] Compilo l'eseguibile (puo' richiedere qualche minuto)...
%PY% -m PyInstaller --noconfirm "SC Portal.spec"
if errorlevel 1 goto err

echo.
echo ============================================================
echo   FATTO! L'app e' qui:   dist\SC Portal.exe
echo   Condividila: chi la riceve fa doppio clic, SENZA Python.
echo   Per portarti la tua libreria, copia accanto al .exe i file
echo   library.json, settings.json e la cartella covers.
echo ============================================================
pause
exit /b 0

:err
echo.
echo [X] Errore durante la creazione. Controlla i messaggi sopra.
pause
exit /b 1
