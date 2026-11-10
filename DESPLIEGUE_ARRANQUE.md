# Arranque automático de ScanFlow en Windows

Con esto ScanFlow arranca solo cuando se enciende el servidor, aunque nadie
inicie sesión. Si se va la luz, al regresar levanta solo. Si el backend o el
frontend se caen, se vuelven a levantar a los 15 segundos. Ya no hace falta
dejar consolas abiertas.

Es el mismo esquema que el DBX, que corre en el mismo servidor. Los dos no
chocan: cada uno tiene sus tareas, sus puertos y sus logs. Todo está en
`deploy\windows\`, dentro de la carpeta del backend.

## Qué instala

Dos tareas en el Programador de tareas. Corren como **SYSTEM**:

| Tarea | Qué hace | Log |
|---|---|---|
| `ScanFlow - backend` | `node src\server.js` al encender el equipo | `logs\backend.log` |
| `ScanFlow - frontend` | sirve el frontend compilado (`dist`) con `vite preview`, en el puerto de siempre (**5174**) | `logs\frontend.log` |

- **No hay reinicio semanal**, como en el DBX, porque la planta escanea en los
  tres turnos.
- Los logs los escribe `registrar.js`. Cuando uno pasa de 20 MB, lo guarda como
  `.anterior` y empieza otro, sin detener nada.

**Cambio importante:** el frontend ya no corre con `npm run dev`. Ahora se sirve
**compilado**. Para las estaciones es más rápido, pero un cambio en el frontend
no se ve hasta compilar. `actualizar.ps1` hace esa compilación.

## Instalar (una sola vez)

1. **Revisa los puertos.**
   - El backend de ScanFlow usa el `PORT=` de su `.env`. Debe ser distinto al
     del DBX: el DBX usa 3000 y 5173.
   - El frontend usa 5174.
   - Si un puerto lo tiene el arranque automático del DBX, el instalador lo
     dice y se detiene. Nunca cierra el DBX.
2. **Cierra las consolas** donde se levantaba ScanFlow a mano. Si alguna sigue
   abierta, el instalador lo detecta. Con `-Forzar` las cierra él.
3. Abre **PowerShell como administrador** en la carpeta del backend y corre:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\windows\instalar.ps1
```

Qué hace:

- Busca el frontend en la carpeta de al lado (`..\scanFlowFrontend`). Si está en
  otro lado, agrega `-Frontend D:\ruta\scanFlowFrontend`.
- Si el frontend no usa el puerto 5174, agrega `-PuertoFrontend <puerto>`.
- Instala las dependencias si faltan y compila el frontend.
- Registra las tareas, arranca todo y revisa que los dos respondan.

4. **Prueba de verdad:** reinicia el servidor y **no inicies sesión**. Desde una
   estación, abre ScanFlow y escanea algo. Debe responder en uno o dos minutos.

La compilación del frontend usa el `VITE_API_URL` del `.env` del frontend. Es el
mismo valor con el que hoy corre `npm run dev`, así que no hay que cambiarlo.

## Día a día

| Qué | Cómo (PowerShell como administrador, en la carpeta del backend) |
|---|---|
| Traer una versión nueva | `powershell -ExecutionPolicy Bypass -File deploy\windows\actualizar.ps1` |
| Reiniciar | `powershell -ExecutionPolicy Bypass -File deploy\windows\reiniciar.ps1` |
| Detener (hasta reiniciar o encender) | `... reiniciar.ps1 -Detener` |
| Ver qué pasó | `logs\backend.log` y `logs\frontend.log` |
| Quitar el arranque automático | `... instalar.ps1 -Quitar` (después se levanta a mano como antes) |

`actualizar.ps1` hace esto:

1. `git pull` en el backend y en el frontend.
2. `npm ci` si cambiaron las dependencias.
3. Compila el frontend.
4. Reinicia los dos. El reinicio tarda unos segundos: si alguien escanea justo
   en ese momento, tiene que volver a escanear. Mejor hazlo entre turnos.

Si el pull trae **migraciones nuevas** (en `migraciones\`), no reinicia: te las
lista con el comando de `psql` para aplicarlas. Antes, respalda la base (desde
la app, en Respaldo). Después corre `reiniciar.ps1`.

## Archivos

| Archivo | Para qué |
|---|---|
| `instalar.ps1` | Registra las tareas (o las quita con `-Quitar`). Se puede volver a correr. |
| `iniciar-backend.cmd`, `iniciar-frontend.cmd` | Lo que corre cada tarea: levantan node y, si se cae, lo vuelven a levantar. |
| `registrar.js` | Escribe el log y lo rota a los 20 MB. |
| `reiniciar.ps1`, `actualizar.ps1`, `comun.ps1` | Reiniciar, actualizar y lo que comparten. |
| `node-dir.txt`, `instalacion.json` | Los genera el instalador en cada equipo (no van a git). |

Lo probé en local con tareas de mi usuario (backend en 3001, frontend en 5174).
Funcionó:

- arrancar los dos;
- matar el backend: volvió solo en 18 segundos;
- detener todo, que no vuelve a levantar;
- rotar el log.

Lo que **no** se pudo probar en local: correr como SYSTEM al encender el equipo,
porque hace falta administrador. Por eso el paso 4 es obligatorio.
