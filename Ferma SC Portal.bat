@echo off
title Ferma SC Portal
echo Arresto di SC Portal in corso...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8082 ^| findstr LISTENING') do taskkill /F /PID %%a >nul 2>nul
echo SC Portal arrestato.
timeout /t 2 >nul
