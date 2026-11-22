@echo off
setlocal
title Lucian - V8.1.3 boton Resend visible
cd /d "%~dp0"
if not exist "%~dp0APLICAR-V81.cjs" (echo ERROR: Extrae TODO el ZIP. & pause & exit /b 1)
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0ACTUALIZAR-LUCIAN.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo No se instalo. El codigo anterior se conserva.
pause
exit /b %RC%
