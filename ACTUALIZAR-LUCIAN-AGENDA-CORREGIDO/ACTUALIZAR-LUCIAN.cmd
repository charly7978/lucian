@echo off
setlocal
title Lucian - Actualizar agenda comercial
cd /d "%~dp0"
if not exist "%~dp0ACTUALIZAR-LUCIAN.ps1" (
  echo ERROR: Falta ACTUALIZAR-LUCIAN.ps1. Extrae el ZIP completo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0ACTUALIZAR-LUCIAN.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo La actualizacion fallo. Tus datos siguen intactos.
echo Presiona una tecla para cerrar esta ventana.
pause
exit /b %RC%
