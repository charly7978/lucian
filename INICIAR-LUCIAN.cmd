@echo off
setlocal
chcp 65001 >nul
TITLE LUCIAN - INICIO
pushd "%~dp0" 2>nul
if errorlevel 1 (
  echo ERROR: No se pudo entrar a la carpeta de Lucian.
  pause
  exit /b 1
)
if not exist "server.mjs" (
  echo ERROR: Falta server.mjs. Debes extraer el ZIP completo.
  pause
  popd
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Falta Node.js.
  echo Instala la version LTS desde https://nodejs.org/
  pause
  popd
  exit /b 1
)
set "LUCIAN_HOST=127.0.0.1"
set "LUCIAN_PORT=4321"
set "LUCIAN_REQUIRE_AUTH=0"
set "LUCIAN_NO_OPEN="
echo.
echo ============================================
echo    LUCIAN - CATALOGO Y VENTAS
echo ============================================
echo.
echo Se abrira el navegador. Si no se abre,
echo visita http://localhost:4321
echo.
echo Tus datos y ajustes se guardan en esta carpeta.
echo Deja abierta esta ventana mientras usas Lucian.
echo.
node tools\start-local.mjs
set "RC=%ERRORLEVEL%"
if not "%RC%" == "0" (
  echo.
  echo Lucian se detuvo con codigo %RC%.
  pause
)
popd
exit /b %RC%
