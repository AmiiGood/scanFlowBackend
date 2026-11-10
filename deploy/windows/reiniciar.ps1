<#
  Reinicia el backend y el frontend de ScanFlow (las tareas que dejó instalar.ps1).
  Se corre a mano:
    powershell -ExecutionPolicy Bypass -File deploy\windows\reiniciar.ps1
  Con -Detener solo los detiene (arrancan otra vez al encender el equipo o con
  este mismo script sin -Detener).
#>
param([switch]$Detener)

. "$PSScriptRoot\comun.ps1"
Exigir-Administrador
$config = Leer-Config

Detener-App $config.Frontend
if ($Detener) {
  Escribir 'ScanFlow detenido.' 'Yellow'
  return
}
Iniciar-App
[void](Revisar-Arranque $config)
