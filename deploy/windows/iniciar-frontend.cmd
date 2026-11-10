@echo off
rem Sirve el frontend de ScanFlow ya compilado (carpeta dist) y lo vuelve a
rem levantar si se cae. Lo ejecuta la tarea programada "ScanFlow - frontend".
rem Log: logs\frontend.log del backend (todos los logs en un solo lugar).
rem
rem Parametros: %1 = carpeta del frontend, %2 = puerto (el mismo de siempre,
rem para que la direccion que usan las estaciones no cambie).
setlocal
set "FRONTEND=%~1"
set "PUERTO=%~2"
if not defined PUERTO set "PUERTO=5174"
cd /d "%~dp0..\.."
if not exist logs mkdir logs
set "LOG=%CD%\logs\frontend.log"

if exist "%~dp0node-dir.txt" set /p NODEDIR=<"%~dp0node-dir.txt"
if defined NODEDIR set "PATH=%NODEDIR%;%PATH%"
set "NO_COLOR=1"

cd /d "%FRONTEND%"

:arrancar
echo.>> "%LOG%"
rem Sin compilar no hay nada que servir: se compila una vez
if not exist "%FRONTEND%\dist\index.html" (
  echo [%date% %time%] No hay dist: compilando >> "%LOG%"
  call npm.cmd run build >> "%LOG%" 2>&1
)
echo [%date% %time%] Sirviendo el frontend en el puerto %PUERTO% >> "%LOG%"
rem Ruta completa a vite: asi reiniciar.ps1 reconoce este proceso
node "%FRONTEND%\node_modules\vite\bin\vite.js" preview --host 0.0.0.0 --port %PUERTO% --strictPort 2>&1 | node "%~dp0registrar.js" "%LOG%"
echo [%date% %time%] El frontend se detuvo. Se reinicia en 15 segundos >> "%LOG%"

ping -n 16 127.0.0.1 >nul
goto arrancar
