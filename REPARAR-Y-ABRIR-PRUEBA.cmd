@echo off
setlocal
title LUCIAN - REPARAR Y ABRIR COPIA DE PRUEBA
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0REPARAR-PRUEBA.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" echo [ERROR] Revisa el mensaje anterior o envia captura a ChatGPT.
if "%RC%"=="0" echo [OK] Ya podes probar Lucian en el navegador.
pause
exit /b %RC%
