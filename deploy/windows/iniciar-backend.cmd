@echo off
rem Levanta el backend de ScanFlow y lo vuelve a levantar si se cae.
rem Lo ejecuta la tarea programada "ScanFlow - backend" al encender el equipo,
rem sin que nadie tenga que iniciar sesion. Log: logs\backend.log
setlocal
cd /d "%~dp0..\.."
set "BACKEND=%CD%"
if not exist logs mkdir logs
set "LOG=%BACKEND%\logs\backend.log"

rem La tarea corre como SYSTEM y su PATH puede no tener a Node: se usa la
rem carpeta de Node que guardo el instalador.
if exist "%~dp0node-dir.txt" set /p NODEDIR=<"%~dp0node-dir.txt"
if defined NODEDIR set "PATH=%NODEDIR%;%PATH%"
rem Sin colores: el log queda legible en el Bloc de notas
set "NO_COLOR=1"

:arrancar
echo.>> "%LOG%"
echo [%date% %time%] Arrancando el backend >> "%LOG%"
rem Ruta completa a server.js: asi reiniciar.ps1 reconoce este proceso.
rem registrar.js escribe el log y lo rota a los 20 MB sin reiniciar.
node "%BACKEND%\src\server.js" 2>&1 | node "%~dp0registrar.js" "%LOG%"
echo [%date% %time%] El backend se detuvo. Se reinicia en 15 segundos >> "%LOG%"

rem "timeout" no funciona sin consola (la tarea no tiene): se espera con ping
ping -n 16 127.0.0.1 >nul
goto arrancar
