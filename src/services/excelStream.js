// Excel de reportes grandes armado en el servidor y enviado por partes. En el
// navegador no cabía (211 mil QRs lo dejaban sin memoria) y en el hilo
// principal frenaba los escaneos de las estaciones mientras se armaba, por eso
// lo arma un hilo aparte (excelWorker.js) y aquí solo se pasan los bytes.
const path = require("path");
const { Worker } = require("worker_threads");

// columnas = [{ titulo, campo, tipo?: "fecha" | "hora", ancho? }]
function enviarExcel(res, { nombre, columnas, sql, params }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "excelWorker.js"), {
      workerData: { columnas, sql, params },
    });
    let terminado = false;
    const acabar = (err) => {
      if (terminado) return;
      terminado = true;
      worker.terminate();
      if (err) reject(err);
      else resolve();
    };

    // Si el usuario cierra la página o cancela, se deja de armar.
    res.on("close", () => {
      if (!res.writableFinished) acabar();
    });

    worker.on("message", (m) => {
      if (m.tipo === "inicio") {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${nombre}.xlsx"`);
      } else if (m.tipo === "datos") {
        res.write(Buffer.from(m.datos));
      } else if (m.tipo === "fin") {
        res.end();
        acabar();
      } else if (m.tipo === "error") {
        acabar(new Error(m.mensaje));
      }
    });
    worker.on("error", acabar);
    worker.on("exit", (code) => {
      if (code !== 0) acabar(new Error("Se interrumpió la exportación"));
    });
  });
}

module.exports = { enviarExcel };
