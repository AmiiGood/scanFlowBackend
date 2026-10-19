const XLSX = require("xlsx");
const pool = require("../config/database");

const COLS_PO = ["PONumber", "CantidadPares", "CantidadCartones"];
const COLS_CARTON = ["PONumber", "CartonID", "SKU", "CantidadPorCarton"];
const ESTADOS_CERRADOS = ["enviado", "cancelado"];

const texto = (v) => (v == null ? "" : String(v).trim());
const esEntero = (n) => Number.isInteger(n) && n >= 0;

function leerHojas(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const hojaPo = wb.Sheets["Po"];
  const hojaCartones = wb.Sheets["Cartones"];
  if (!hojaPo || !hojaCartones)
    throw {
      status: 400,
      message: `El archivo debe tener las hojas «Po» y «Cartones». Trae: ${wb.SheetNames.join(", ")}`,
    };
  const poRows = XLSX.utils.sheet_to_json(hojaPo, { defval: null, raw: true });
  const cartonRows = XLSX.utils.sheet_to_json(hojaCartones, { defval: null, raw: true });
  if (!poRows.length) throw { status: 400, message: "La hoja «Po» está vacía" };
  const revisar = (rows, cols, hoja) => {
    const faltan = rows.length ? cols.filter((c) => !(c in rows[0])) : [];
    if (faltan.length)
      throw {
        status: 400,
        message: `Faltan columnas en la hoja «${hoja}»: ${faltan.join(", ")}. Se encontraron: ${Object.keys(rows[0]).join(", ")}`,
      };
  };
  revisar(poRows, COLS_PO, "Po");
  revisar(cartonRows, COLS_CARTON, "Cartones");
  return { poRows, cartonRows };
}

const mismoContenido = (a, b) => {
  const k = (m) => [...m].map(([s, n]) => `${s}:${n}`).sort().join("|");
  return k(a) === k(b);
};

// Revisa el archivo completo contra la base y devuelve qué pasaría con cada PO
// y cada cartón. No escribe nada.
async function analizar(buffer) {
  const { poRows, cartonRows } = leerHojas(buffer);
  const erroresArchivo = [];

  // --- Hoja Po
  const pos = new Map();
  for (const [i, r] of poRows.entries()) {
    const linea = i + 2;
    const po_number = texto(r.PONumber);
    if (!po_number && r.CantidadPares == null && r.CantidadCartones == null) continue;
    if (!po_number) {
      erroresArchivo.push(`Hoja Po, línea ${linea}: falta el PONumber`);
      continue;
    }
    const p = {
      po_number,
      cantidad_pares: Number(r.CantidadPares),
      cantidad_cartones: Number(r.CantidadCartones),
      errores: [],
      avisos: [],
      cartones: new Map(),
    };
    if (!esEntero(p.cantidad_pares) || !esEntero(p.cantidad_cartones))
      p.errores.push("CantidadPares o CantidadCartones no son números enteros");
    if (pos.has(po_number)) {
      pos.get(po_number).errores.push(`Aparece dos veces en la hoja Po (también en la línea ${linea})`);
      continue;
    }
    pos.set(po_number, p);
  }

  // --- Hoja Cartones
  const poDelCarton = new Map();
  const sinPo = new Map();
  for (const [i, r] of cartonRows.entries()) {
    const linea = i + 2;
    const po_number = texto(r.PONumber);
    const carton_id = texto(r.CartonID);
    const sku = texto(r.SKU).toUpperCase();
    const cantidad = Number(r.CantidadPorCarton);
    if (!po_number && !carton_id && !sku && r.CantidadPorCarton == null) continue;

    const p = pos.get(po_number);
    if (!p) {
      sinPo.set(po_number || "(vacío)", (sinPo.get(po_number || "(vacío)") || 0) + 1);
      continue;
    }
    if (!carton_id) {
      p.errores.push(`Hoja Cartones, línea ${linea}: falta el CartonID`);
      continue;
    }
    if (!p.cartones.has(carton_id))
      p.cartones.set(carton_id, { carton_id, detalles: new Map(), errores: [] });
    const c = p.cartones.get(carton_id);

    // Un CartonID de 20 dígitos guardado como número en Excel pierde los ceros
    // de la izquierda y los últimos dígitos: ya no coincide con la etiqueta.
    if (typeof r.CartonID === "number")
      c.errores.push(`CartonID guardado como número en Excel (línea ${linea}); dale formato de texto para no perder dígitos`);
    if (!sku) c.errores.push(`Línea ${linea}: falta el SKU`);
    if (!Number.isInteger(cantidad) || cantidad <= 0)
      c.errores.push(`Línea ${linea}: CantidadPorCarton inválida (${texto(r.CantidadPorCarton) || "vacía"})`);
    if (sku && Number.isInteger(cantidad) && cantidad > 0)
      c.detalles.set(sku, (c.detalles.get(sku) || 0) + cantidad);

    const otraPo = poDelCarton.get(carton_id);
    if (otraPo && otraPo !== po_number) {
      const msg = `El cartón está en dos POs del archivo (${otraPo} y ${po_number})`;
      c.errores.push(msg);
      const c2 = pos.get(otraPo)?.cartones.get(carton_id);
      if (c2 && !c2.errores.includes(msg)) c2.errores.push(msg);
    } else poDelCarton.set(carton_id, po_number);
  }
  for (const [po, n] of sinPo)
    erroresArchivo.push(`La hoja Cartones trae ${n} ${n === 1 ? "fila" : "filas"} de la PO ${po}, que no está en la hoja Po`);

  // --- Lo que ya hay en la base
  const { rows: skuRows } = await pool.query("SELECT id, sku_number, size FROM skus");
  const skus = new Map(skuRows.map((s) => [s.sku_number, s]));

  const numeros = [...pos.keys()];
  const { rows: poRowsDb } = await pool.query(
    "SELECT id, po_number, estado FROM purchase_orders WHERE po_number = ANY($1)",
    [numeros],
  );
  const posDb = new Map(poRowsDb.map((p) => [p.po_number, p]));

  const idsCarton = [...poDelCarton.keys()];
  const { rows: cartonesDb } = await pool.query(
    `SELECT c.id, c.carton_id, po.po_number,
            (SELECT COUNT(*) FROM escaneos e WHERE e.carton_id = c.id)
          + (SELECT COUNT(*) FROM cajas ca WHERE ca.carton_id = c.id) AS uso,
            COALESCE((SELECT json_agg(json_build_object('sku', s.sku_number, 'cantidad', d.cantidad_por_carton))
                        FROM carton_detalles d JOIN skus s ON s.id = d.sku_id
                       WHERE d.carton_id = c.id), '[]') AS detalles
       FROM cartones c
       JOIN purchase_orders po ON po.id = c.po_id
      WHERE c.carton_id = ANY($1)`,
    [idsCarton],
  );
  const cartonDb = new Map(cartonesDb.map((c) => [c.carton_id, c]));

  const { rows: sobrantes } = poRowsDb.length
    ? await pool.query(
        `SELECT po_id, COUNT(*)::int AS n FROM cartones
          WHERE po_id = ANY($1) AND NOT (carton_id = ANY($2))
          GROUP BY po_id`,
        [poRowsDb.map((p) => p.id), idsCarton],
      )
    : { rows: [] };
  const sobrantesPorPo = new Map(sobrantes.map((r) => [r.po_id, r.n]));

  // --- Veredicto por PO y por cartón
  const faltantes = new Map();
  const resultadoPos = [];
  for (const p of pos.values()) {
    const db = posDb.get(p.po_number);
    if (db && ESTADOS_CERRADOS.includes(db.estado))
      p.errores.push(`La PO ya está «${db.estado}» en ScanFlow; no se modifica`);
    if (!p.cartones.size) p.errores.push("No tiene cartones en la hoja Cartones");

    const cuenta = { nuevo: 0, actualiza: 0, sin_cambios: 0, rechazado: 0 };
    const rechazados = [];
    let paresHoja = 0;
    for (const c of p.cartones.values()) {
      for (const n of c.detalles.values()) paresHoja += n;
      for (const sku of c.detalles.keys()) {
        if (skus.has(sku)) continue;
        c.errores.push(`SKU no está en el catálogo: ${sku}`);
        const f = faltantes.get(sku) || { sku, cartones: 0, pares: 0, pos: new Set() };
        f.cartones++;
        f.pares += c.detalles.get(sku);
        f.pos.add(p.po_number);
        faltantes.set(sku, f);
      }
      const ex = cartonDb.get(c.carton_id);
      if (ex && ex.po_number !== p.po_number) c.errores.push(`Ya pertenece a la PO ${ex.po_number}`);

      if (c.errores.length) c.estado = "rechazado";
      else if (!ex) c.estado = "nuevo";
      else {
        const actual = new Map(ex.detalles.map((d) => [d.sku, d.cantidad]));
        if (mismoContenido(actual, c.detalles)) c.estado = "sin_cambios";
        else if (Number(ex.uso) > 0) {
          c.errores.push("Ya tiene pares escaneados y su contenido cambió; no se modifica");
          c.estado = "rechazado";
        } else c.estado = "actualiza";
        c.id = ex.id;
      }
      cuenta[c.estado]++;
      if (c.estado === "rechazado") rechazados.push({ carton_id: c.carton_id, errores: c.errores });
    }

    if (esEntero(p.cantidad_cartones) && p.cartones.size && p.cartones.size !== p.cantidad_cartones)
      p.avisos.push(`La hoja Po dice ${p.cantidad_cartones} cartones y la hoja Cartones trae ${p.cartones.size}`);
    if (esEntero(p.cantidad_pares) && paresHoja && paresHoja !== p.cantidad_pares)
      p.avisos.push(`La hoja Po dice ${p.cantidad_pares} pares y los cartones suman ${paresHoja}`);
    if (db && sobrantesPorPo.get(db.id))
      p.avisos.push(`${sobrantesPorPo.get(db.id)} cartones que ya están en ScanFlow no vienen en el archivo (no se borran)`);

    resultadoPos.push({
      po_number: p.po_number,
      existe: !!db,
      estado_actual: db?.estado || null,
      cantidad_pares: p.cantidad_pares,
      cantidad_cartones: p.cantidad_cartones,
      cartones_en_archivo: p.cartones.size,
      ...cuenta,
      estado: p.errores.length ? "error" : cuenta.rechazado ? "incompleta" : "ok",
      errores: p.errores,
      avisos: p.avisos,
      rechazados,
    });
  }

  // Un SKU "faltante" muchas veces existe con el ArSKU mal capturado, sin la
  // talla al final (pasó con 61 SKUs de tallas M9W11, C9 y J6).
  const listaFaltantes = [...faltantes.values()]
    .map((f) => {
      const m = f.sku.match(/^(.*)-([^-]+)$/);
      const base = m && skus.get(m[1]);
      return {
        sku: f.sku,
        cartones: f.cartones,
        pares: f.pares,
        pos: [...f.pos],
        style_no: f.sku.split("-")[0],
        size: m ? m[2] : null,
        sugerencia:
          base && base.size === m[2]
            ? `Existe «${base.sku_number}» con talla ${base.size}: corrige su ArSKU a «${f.sku}» en lugar de cargar uno nuevo`
            : null,
      };
    })
    .sort((a, b) => b.cartones - a.cartones);

  const suma = (k) => resultadoPos.reduce((a, p) => a + p[k], 0);
  return {
    resumen: {
      pos: resultadoPos.length,
      ok: resultadoPos.filter((p) => p.estado === "ok").length,
      incompletas: resultadoPos.filter((p) => p.estado === "incompleta").length,
      con_error: resultadoPos.filter((p) => p.estado === "error").length,
      cartones_nuevos: suma("nuevo"),
      cartones_actualizados: suma("actualiza"),
      cartones_sin_cambios: suma("sin_cambios"),
      cartones_rechazados: suma("rechazado"),
    },
    errores_archivo: erroresArchivo,
    faltantes: listaFaltantes,
    pos: resultadoPos,
    _detalle: pos, // uso interno de importar(); no se envía al cliente
  };
}

// Estado de la PO según sus cartones. Una PO no se marca completa si tiene
// menos cartones de los que dice su Excel (CantidadCartones).
async function recalcularEstado(client, po_id) {
  await client.query(
    `UPDATE purchase_orders po
        SET estado = CASE
              WHEN t.completos = 0 THEN 'pendiente'
              WHEN t.completos = t.total AND t.total >= po.cantidad_cartones THEN 'completo'
              ELSE 'en_proceso' END
       FROM (SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE estado = 'completo') AS completos
               FROM cartones WHERE po_id = $1) t
      WHERE po.id = $1 AND po.estado NOT IN ('enviado', 'cancelado')`,
    [po_id],
  );
}

// Carga lo válido: POs sin error y, dentro de ellas, los cartones nuevos o
// con cambios. Los rechazados no se tocan. Cada PO va en su transacción.
async function importar(buffer) {
  const analisis = await analizar(buffer);
  const detalle = analisis._detalle;
  delete analisis._detalle;

  const { rows: skuRows } = await pool.query("SELECT id, sku_number FROM skus");
  const skuId = new Map(skuRows.map((s) => [s.sku_number, s.id]));

  for (const res of analisis.pos) {
    if (res.estado === "error") continue;
    const p = detalle.get(res.po_number);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `INSERT INTO purchase_orders (po_number, cantidad_pares, cantidad_cartones)
         VALUES ($1, $2, $3)
         ON CONFLICT (po_number) DO UPDATE SET
           cantidad_pares = EXCLUDED.cantidad_pares,
           cantidad_cartones = EXCLUDED.cantidad_cartones
         RETURNING id`,
        [p.po_number, p.cantidad_pares, p.cantidad_cartones],
      );
      const po_id = rows[0].id;

      const nuevos = [...p.cartones.values()].filter((c) => c.estado === "nuevo");
      const cambian = [...p.cartones.values()].filter((c) => c.estado === "actualiza");
      const tipo = (c) => (c.detalles.size > 1 ? "musical" : "mono_sku");

      if (nuevos.length) {
        const { rows: insertados } = await client.query(
          `INSERT INTO cartones (carton_id, po_id, tipo)
           SELECT x, $2, t FROM unnest($1::text[], $3::text[]) AS u(x, t)
           RETURNING id, carton_id`,
          [nuevos.map((c) => c.carton_id), po_id, nuevos.map(tipo)],
        );
        const idDe = new Map(insertados.map((r) => [r.carton_id, r.id]));
        for (const c of nuevos) c.id = idDe.get(c.carton_id);
      }
      for (const c of cambian) {
        await client.query("UPDATE cartones SET tipo = $1 WHERE id = $2", [tipo(c), c.id]);
        await client.query("DELETE FROM carton_detalles WHERE carton_id = $1", [c.id]);
      }
      const conDetalle = [...nuevos, ...cambian];
      if (conDetalle.length) {
        const ids = [], sk = [], cant = [];
        for (const c of conDetalle)
          for (const [sku, n] of c.detalles) {
            ids.push(c.id);
            sk.push(skuId.get(sku));
            cant.push(n);
          }
        await client.query(
          `INSERT INTO carton_detalles (carton_id, sku_id, cantidad_por_carton)
           SELECT * FROM unnest($1::int[], $2::int[], $3::int[])`,
          [ids, sk, cant],
        );
      }
      await recalcularEstado(client, po_id);
      await client.query("COMMIT");
      res.cargada = true;
    } catch (err) {
      await client.query("ROLLBACK");
      res.estado = "error";
      res.errores.push(`No se pudo cargar: ${err.message}`);
    } finally {
      client.release();
    }
  }

  return { ...analisis, cargado: true };
}

// Para el validador: quita la estructura interna antes de responder.
async function analizarParaCliente(buffer) {
  const a = await analizar(buffer);
  delete a._detalle;
  return a;
}

module.exports = { analizar: analizarParaCliente, importar, recalcularEstado };
