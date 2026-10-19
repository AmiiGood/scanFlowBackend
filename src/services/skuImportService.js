const XLSX = require("xlsx");
const pool = require("../config/database");

const REQUIRED_COLS = ["ArSKU", "UPC", "StyleNo", "StyleName", "Size"];

const texto = (v) => (v == null ? "" : String(v).trim());

// Lee la primera hoja y revisa cada fila contra el resto del archivo y contra
// el catálogo. No escribe nada: devuelve qué pasaría con cada fila.
async function analizar(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  if (!rows.length) throw { status: 400, message: "El archivo está vacío (la primera hoja no tiene filas)" };
  const faltantes = REQUIRED_COLS.filter((c) => !(c in rows[0]));
  if (faltantes.length)
    throw {
      status: 400,
      message: `Faltan columnas en la primera hoja: ${faltantes.join(", ")}. Se encontraron: ${Object.keys(rows[0]).join(", ")}`,
    };

  const { rows: catalogo } = await pool.query(
    `SELECT s.id, s.sku_number, s.upc, s.style_no, s.style_name, s.color,
            s.color_name, s.size
       FROM skus s`,
  );
  const porSku = new Map(catalogo.map((s) => [s.sku_number, s]));
  const porUpc = new Map(catalogo.map((s) => [s.upc, s]));

  const vistosSku = new Map();
  const vistosUpc = new Map();
  const filas = [];

  for (const [i, row] of rows.entries()) {
    const linea = i + 2;
    const f = {
      linea,
      sku_number: texto(row.ArSKU).toUpperCase(),
      upc: texto(row.UPC).replace(/\s+/g, ""),
      style_no: texto(row.StyleNo) || null,
      style_name: texto(row.StyleName) || null,
      color: texto(row.Color) || null,
      color_name: texto(row.ColorName) || null,
      size: texto(row.Size).toUpperCase() || null,
    };
    // Las filas totalmente vacías al final del archivo no cuentan.
    if (!f.sku_number && !f.upc && !f.style_no && !f.size) continue;

    const errores = [];
    if (!f.sku_number) errores.push("Falta el ArSKU");
    if (!f.upc) errores.push("Falta el UPC");
    else if (!/^\d{12,14}$/.test(f.upc))
      errores.push(`UPC inválido «${f.upc}»: deben ser de 12 a 14 dígitos`);
    if (!f.size) errores.push("Falta la talla (Size)");
    if (!f.style_no) errores.push("Falta el StyleNo");
    if (!f.style_name) errores.push("Falta el StyleName");

    if (f.sku_number && f.size && !f.sku_number.endsWith(`-${f.size}`))
      errores.push(`El ArSKU no termina en su talla: debería ser «${f.sku_number}-${f.size}» o la talla no es ${f.size}`);
    if (f.sku_number && f.style_no && !f.sku_number.startsWith(`${f.style_no.toUpperCase()}-`))
      errores.push(`El ArSKU no empieza con su StyleNo (${f.style_no})`);

    if (f.sku_number && vistosSku.has(f.sku_number))
      errores.push(`ArSKU repetido: también está en la línea ${vistosSku.get(f.sku_number)}`);
    if (f.upc && vistosUpc.has(f.upc) && vistosUpc.get(f.upc).sku !== f.sku_number)
      errores.push(`UPC repetido: también es del ArSKU ${vistosUpc.get(f.upc).sku} (línea ${vistosUpc.get(f.upc).linea})`);
    if (f.sku_number && !vistosSku.has(f.sku_number)) vistosSku.set(f.sku_number, linea);
    if (f.upc && !vistosUpc.has(f.upc)) vistosUpc.set(f.upc, { sku: f.sku_number, linea });

    const existente = porSku.get(f.sku_number);
    const duenoUpc = porUpc.get(f.upc);
    if (duenoUpc && duenoUpc.sku_number !== f.sku_number) {
      const sinTalla = duenoUpc.size && !duenoUpc.sku_number.endsWith(`-${duenoUpc.size}`);
      errores.push(
        `El UPC ${f.upc} ya es del SKU «${duenoUpc.sku_number}»` +
          (sinTalla
            ? `, que está mal capturado sin su talla (debería ser «${duenoUpc.sku_number}-${duenoUpc.size}»). Corrige ese ArSKU en el catálogo en lugar de cargar uno nuevo`
            : ""),
      );
    }

    let estado;
    const cambios = [];
    if (errores.length) {
      estado = "error";
    } else if (!existente) {
      estado = "nuevo";
    } else {
      for (const k of ["upc", "style_no", "style_name", "color", "color_name", "size"]) {
        // Una columna opcional vacía no borra lo que ya tiene el catálogo.
        if (f[k] != null && f[k] !== (existente[k] ?? null)) cambios.push(k);
      }
      estado = cambios.length ? "actualiza" : "sin_cambios";
    }

    filas.push({ ...f, estado, errores, cambios, id: existente?.id || null, upc_anterior: cambios.includes("upc") ? existente.upc : null });
  }

  // Cambiar el UPC de un SKU que ya tiene QRs ligados dejaría esos QRs con el
  // UPC viejo apuntando a este SKU: se rechaza.
  const cambianUpc = filas.filter((f) => f.estado === "actualiza" && f.upc_anterior);
  if (cambianUpc.length) {
    const { rows: ligados } = await pool.query(
      "SELECT sku_id, COUNT(*)::int AS n FROM codigos_qr WHERE sku_id = ANY($1) GROUP BY sku_id",
      [cambianUpc.map((f) => f.id)],
    );
    const n = new Map(ligados.map((r) => [r.sku_id, r.n]));
    for (const f of cambianUpc) {
      if (n.get(f.id)) {
        f.estado = "error";
        f.errores.push(`El SKU ya tiene ${n.get(f.id).toLocaleString("es-MX")} QRs ligados con el UPC ${f.upc_anterior}; el UPC no se cambia desde la plantilla`);
      }
    }
  }

  const cuenta = (e) => filas.filter((f) => f.estado === e).length;
  return {
    resumen: {
      total: filas.length,
      nuevos: cuenta("nuevo"),
      actualizados: cuenta("actualiza"),
      sin_cambios: cuenta("sin_cambios"),
      errores: cuenta("error"),
    },
    filas,
  };
}

// Carga las filas válidas en una sola transacción y liga los QRs huérfanos
// de esos UPCs. Las filas con error no se cargan.
async function importar(buffer) {
  const analisis = await analizar(buffer);
  const aplicar = analisis.filas.filter((f) => f.estado === "nuevo" || f.estado === "actualiza");

  const client = await pool.connect();
  let vinculados = 0;
  try {
    await client.query("BEGIN");
    for (const f of aplicar) {
      if (f.estado === "nuevo") {
        await client.query(
          `INSERT INTO skus (sku_number, upc, style_no, style_name, color, color_name, size)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [f.sku_number, f.upc, f.style_no, f.style_name, f.color, f.color_name, f.size],
        );
      } else {
        await client.query(
          `UPDATE skus SET upc = $2,
                  style_no = COALESCE($3, style_no), style_name = COALESCE($4, style_name),
                  color = COALESCE($5, color), color_name = COALESCE($6, color_name),
                  size = COALESCE($7, size)
            WHERE id = $1`,
          [f.id, f.upc, f.style_no, f.style_name, f.color, f.color_name, f.size],
        );
      }
    }
    if (aplicar.length) {
      const { rowCount } = await client.query(
        `UPDATE codigos_qr q SET sku_id = s.id
           FROM skus s
          WHERE q.sku_id IS NULL AND q.upc = s.upc AND s.upc = ANY($1)`,
        [aplicar.map((f) => f.upc)],
      );
      vinculados = rowCount;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { ...analisis, cargado: true, qrs_vinculados: vinculados };
}

module.exports = { analizar, importar };
