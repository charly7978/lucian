@echo off
setlocal
title LUCIAN - PROBAR DIRECTOR COMERCIAL IA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0PREPARAR-PRUEBA.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [ERROR] No se pudo preparar la prueba. Lee el mensaje anterior.
if "%RC%"=="0" echo [OK] Se preparo la prueba. Manten abierta la ventana de Lucian.
pause
exit /b %RC%
