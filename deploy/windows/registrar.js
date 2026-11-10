/**
 * Recibe por la entrada estándar la salida del backend o del frontend y la
 * escribe en el log. Cuando el archivo pasa de 20 MB lo guarda como
 * "<log>.anterior" y empieza otro, sin tener que reiniciar nada: ScanFlow
 * escanea en los tres turnos y no conviene detenerlo para rotar el log.
 *
 *   node server.js 2>&1 | node registrar.js logs\backend.log
 *
 * Sin dependencias. Termina solo cuando el proceso de la izquierda termina.
 * Escribe de forma síncrona: así cerrar, renombrar y abrir el siguiente es
 * un solo paso y no se pierde ni se mezcla nada.
 */
const fs = require("fs");

const archivo = process.argv[2];
// El tercer argumento (bytes) es solo para probar la rotación con algo chico
const LIMITE = Number(process.argv[3]) || 20 * 1024 * 1024;

if (!archivo) {
  console.error("Uso: node registrar.js <archivo de log>");
  process.exit(2);
}

let fd = fs.openSync(archivo, "a");
let tamano = fs.fstatSync(fd).size;

function rotar() {
  fs.closeSync(fd);
  try {
    fs.renameSync(archivo, `${archivo}.anterior`);
  } catch {
    // Si alguien lo tiene abierto con bloqueo, se sigue en el mismo y se
    // vuelve a intentar con el siguiente renglón
  }
  fd = fs.openSync(archivo, "a");
  tamano = fs.fstatSync(fd).size;
}

process.stdin.on("data", (pedazo) => {
  if (tamano + pedazo.length > LIMITE && tamano > 0) rotar();
  fs.writeSync(fd, pedazo);
  tamano += pedazo.length;
});

process.stdin.on("end", () => fs.closeSync(fd));
