// Hilo aparte que arma el Excel (ver excelStream.js). Lee las filas con un
// cursor, las escribe con exceljs y le pasa los bytes al hilo principal.
const { parentPort, workerData } = require("worker_threads");
const { Writable } = require("stream");
const ExcelJS = require("exceljs");
const Cursor = require("pg-cursor");
const pool = require("../config/database");

const LOTE = 2000;
const FORMATO = { fecha: "dd/mm/yyyy", hora: "hh:mm:ss AM/PM" };

// Las fechas llegan como texto "YYYY-MM-DD HH:MM:SS" (hora de planta) y se
// guardan como fecha/hora de Excel para que se puedan ordenar y filtrar.
function celda(valor, tipo) {
  if (valor == null || valor === "") return null;
  if (tipo === "fecha") {
    const [y, m, d] = valor.slice(0, 10).split("-").map(Number);
    // Serial de Excel: días desde 1899-12-30.
    return Date.UTC(y, m - 1, d) / 86400000 + 25569;
  }
  if (tipo === "hora") {
    const [h, mi, s] = valor.slice(11, 19).split(":").map(Number);
    return (h * 3600 + mi * 60 + s) / 86400;
  }
  return valor;
}

const alPrincipal = new Writable({
  write(chunk, _enc, listo) {
    const datos = new Uint8Array(chunk).slice().buffer;
    parentPort.postMessage({ tipo: "datos", datos }, [datos]);
    listo();
  },
});

async function armar({ columnas, sql, params }) {
  const client = await pool.connect();
  const cursor = client.query(new Cursor(sql, params));
  try {
    // El primer lote se lee antes de avisar: si la consulta falla, el
    // principal todavía puede responder con un error normal.
    let filas = await cursor.read(LOTE);
    parentPort.postMessage({ tipo: "inicio" });

    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: alPrincipal, useStyles: true, useSharedStrings: false });
    const ws = wb.addWorksheet("Reporte");
    ws.columns = columnas.map((c) => ({
      header: c.titulo,
      width: c.ancho || 14,
      style: FORMATO[c.tipo] ? { numFmt: FORMATO[c.tipo] } : undefined,
    }));
    while (filas.length) {
      for (const fila of filas) ws.addRow(columnas.map((c) => celda(fila[c.campo], c.tipo))).commit();
      filas = await cursor.read(LOTE);
    }
    ws.commit();
    await wb.commit();
    parentPort.postMessage({ tipo: "fin" });
  } finally {
    await cursor.close().catch(() => {});
    client.release();
    await pool.end();
  }
}

armar(workerData).catch((err) => parentPort.postMessage({ tipo: "error", mensaje: err.message }));
