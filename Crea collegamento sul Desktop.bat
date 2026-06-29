@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('Desktop'); $w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path $d 'SC Portal.lnk')); $s.TargetPath='%~dp0SC Portal.vbs'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0static\favicon.ico'; $s.Description='Apri SC Portal'; $s.Save()"
echo.
echo Fatto: trovi "SC Portal" sul Desktop. Doppio clic per avviare.
pause
