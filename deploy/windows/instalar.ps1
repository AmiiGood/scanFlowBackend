<#
  Deja ScanFlow arrancando solo: al encender el equipo (sin que nadie inicie
  sesión) y cada vez que se caiga.

  Registra en el Programador de tareas, como SYSTEM:
    ScanFlow - backend    node src\server.js     (logs\backend.log)
    ScanFlow - frontend   vite preview de dist   (logs\frontend.log)

  No hay reinicio semanal: la planta escanea en los tres turnos. Los logs los
  rota registrar.js a los 20 MB sin detener nada.

  Uso (PowerShell como administrador, desde la carpeta del backend):
    powershell -ExecutionPolicy Bypass -File deploy\windows\instalar.ps1
    ... -Frontend D:\ScanFlow\scanFlowFrontend -PuertoFrontend 5174
    ... -Forzar      cierra lo que ya esté ocupando los puertos (las consolas de antes)
    ... -Quitar      detiene ScanFlow y borra las tareas

  Se puede volver a correr cuantas veces sea: reemplaza las tareas.
#>
param(
  [string]$Frontend,
  [int]$PuertoFrontend = 5174,
  [switch]$Forzar,
  [switch]$Quitar
)

. "$PSScriptRoot\comun.ps1"
Exigir-Administrador

if ($Quitar) {
  $front = if (Test-Path $script:ArchivoConfig) { (Leer-Config).Frontend } else { $Frontend }
  Detener-App $front
  foreach ($t in @($script:TareaBackend, $script:TareaFrontend)) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $t -Confirm:$false
      Escribir "Tarea borrada: $t"
    }
  }
  Remove-Item $script:ArchivoConfig -ErrorAction SilentlyContinue
  Escribir 'Listo. ScanFlow ya no arranca solo; se puede levantar a mano como antes.' 'Green'
  return
}

# ---------------------------------------------------------------------------
# 1. Carpetas, Node y configuración
# ---------------------------------------------------------------------------
if (-not $Frontend) { $Frontend = Join-Path (Split-Path $script:Backend -Parent) 'scanFlowFrontend' }
if (-not (Test-Path (Join-Path $Frontend 'package.json'))) {
  throw "No encuentro el frontend en '$Frontend'. Pásalo con -Frontend <carpeta>."
}
$Frontend = (Resolve-Path $Frontend).Path
if (-not (Test-Path (Join-Path $script:Backend '.env'))) { throw "Falta el .env del backend en $($script:Backend)" }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'No encuentro Node en el PATH. Instálalo o abre una consola donde "node -v" funcione.' }
# SYSTEM puede no tener a Node en su PATH (si se instaló solo para un usuario)
Set-Content -Path (Join-Path $PSScriptRoot 'node-dir.txt') -Value (Split-Path $node.Source -Parent) -Encoding ASCII
Escribir "Node $(& node -v) en $(Split-Path $node.Source -Parent)"

$PuertoBackend = Puerto-Backend
Escribir "Backend:  $($script:Backend)  (puerto $PuertoBackend, del .env)"
Escribir "Frontend: $Frontend  (puerto $PuertoFrontend)"

# ---------------------------------------------------------------------------
# 2. Lo que esté ocupando los puertos (las consolas de antes)
# ---------------------------------------------------------------------------
# ¿Lo levantó el arranque automático de otra aplicación (el DBX, por ejemplo)?
function De-OtroArranque([int]$id) {
  for ($i = 0; $i -lt 4 -and $id; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $id"
    if (-not $p) { return $null }
    if ($p.CommandLine -match 'iniciar-(backend|frontend)\.cmd' -and
        $p.CommandLine -notmatch [regex]::Escape($PSScriptRoot)) { return $p.CommandLine }
    $id = $p.ParentProcessId
  }
  return $null
}

Detener-App $Frontend
$ocupados = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in @($PuertoBackend, $PuertoFrontend) } |
  Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 4 })
if ($ocupados.Count) {
  foreach ($id in $ocupados) {
    $otro = De-OtroArranque $id
    if ($otro) {
      throw "El puerto lo usa otra aplicación con arranque automático:`n  $otro`nCambia el puerto de ScanFlow (PORT= en el .env o -PuertoFrontend)."
    }
  }
  $detalle = $ocupados | ForEach-Object {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $_"
    "  PID $_  $($p.Name)  $($p.CommandLine)"
  }
  if (-not $Forzar) {
    Escribir 'Los puertos ya están ocupados, seguramente por las consolas donde se levantaba a mano:' 'Yellow'
    $detalle | ForEach-Object { Escribir $_ 'Yellow' }
    throw 'Cierra esas consolas y vuelve a correrlo, o agrega -Forzar para cerrarlas desde aquí.'
  }
  Escribir 'Cerrando lo que ocupa los puertos:' 'Yellow'
  $detalle | ForEach-Object { Escribir $_ 'Yellow' }
  foreach ($id in $ocupados) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

# ---------------------------------------------------------------------------
# 3. Dependencias y compilación del frontend
# ---------------------------------------------------------------------------
foreach ($carpeta in @($script:Backend, $Frontend)) {
  if (-not (Test-Path (Join-Path $carpeta 'node_modules'))) {
    Escribir "Instalando dependencias en $carpeta..."
    Npm $carpeta @('ci')
  }
}
Escribir 'Compilando el frontend (npm run build)...'
Npm $Frontend @('run', 'build')

# ---------------------------------------------------------------------------
# 4. Tareas
# ---------------------------------------------------------------------------
$sistema = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
# Sin límite de tiempo (Windows las corta a las 72 h por omisión) y, si la tarea
# misma falla, otro intento cada minuto. Que node se caiga lo cubre el cmd, que
# lo vuelve a levantar a los 15 segundos.
$ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
$alEncender = New-ScheduledTaskTrigger -AtStartup

$accionB = New-ScheduledTaskAction -Execute (Join-Path $PSScriptRoot 'iniciar-backend.cmd') -WorkingDirectory $script:Backend
Register-ScheduledTask -TaskName $script:TareaBackend -Action $accionB -Trigger $alEncender -Principal $sistema `
  -Settings $ajustes -Description 'Backend de ScanFlow. Arranca al encender el equipo y se levanta solo si se cae. Log: logs\backend.log' -Force | Out-Null

$accionF = New-ScheduledTaskAction -Execute (Join-Path $PSScriptRoot 'iniciar-frontend.cmd') `
  -Argument "`"$Frontend`" $PuertoFrontend" -WorkingDirectory $Frontend
Register-ScheduledTask -TaskName $script:TareaFrontend -Action $accionF -Trigger $alEncender -Principal $sistema `
  -Settings $ajustes -Description 'Frontend de ScanFlow (dist con vite preview). Arranca al encender el equipo y se levanta solo si se cae. Log: logs\frontend.log del backend' -Force | Out-Null

[pscustomobject]@{ Frontend = $Frontend; PuertoFrontend = $PuertoFrontend; Instalado = (Get-Date).ToString('yyyy-MM-dd HH:mm') } |
  ConvertTo-Json | Set-Content -Path $script:ArchivoConfig -Encoding UTF8

Escribir "Tareas registradas: $($script:TareaBackend), $($script:TareaFrontend)" 'Green'

# ---------------------------------------------------------------------------
# 5. Arrancar y revisar
# ---------------------------------------------------------------------------
Iniciar-App
if (Revisar-Arranque (Leer-Config)) {
  Escribir ''
  Escribir 'Listo. Desde ahora ScanFlow arranca solo al encender el equipo y se levanta si se cae.' 'Green'
  Escribir 'Ya no hace falta dejar consolas abiertas.' 'Green'
}
