@echo off
setlocal
title Lucian V7.1 - Diagnostico y correccion de APIs
cd /d "%~dp0"
if not exist "%~dp0ACTUALIZAR-LUCIAN.ps1" (
  echo ERROR: Falta el actualizador. Usa Extraer todo en el ZIP.
  pause
  exit /b 1
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0ACTUALIZAR-LUCIAN.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo Actualizacion no completada. Revisa el mensaje anterior.
echo Presiona una tecla para cerrar esta ventana.
pause
exit /b %RC%
