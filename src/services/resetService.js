const pool = require("../config/database");
const { recalcularEstado } = require("./poImportService");

const MOTIVOS = {
  escaneo_equivocado: "Escaneo equivocado (par o caja incorrectos)",
  caja_corregida: "La caja se abre o se corrige",
  carton_equivocado: "Cartón o PO equivocados",
  etiqueta: "Error en la etiqueta",
  prueba: "Prueba o capacitación",
  otro: "Otro",
};

const TIPOS = {
  caja: "Reset de caja",
  carton: "Reset de cartón",
  po: "Reset de PO",
  desasociar_caja: "Desasociar caja",
};

// Cada reset queda registrado en la misma transacción: si el registro falla,
// el reset no se hace.
async function registrar(client, auditoria, tipo, objetivo_id, codigo, resultado) {
  await client.query(
    `INSERT INTO reseteos
       (tipo, objetivo_id, codigo, supervisor_id, motivo, comentario, resultado, hecho_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tipo, objetivo_id, codigo, auditoria.supervisor_id, auditoria.motivo,
     auditoria.comentario, JSON.stringify(resultado), auditoria.user_id],
  );
}

// Una PO enviada a T4 ya tiene sus QRs asociados allá: primero se cancela el envío.
function bloquearSiEnviada(po) {
  if (po?.estado === "enviado")
    throw {
      status: 409,
      message: `La PO ${po.po_number} ya se envió a T4: cancela el envío antes de resetear`,
    };
}

// Quita los pares de una caja de los cartones donde estén (caja completa en un
// cartón, camas, divisiones, QR por QR o musicales por PO) sin tocar su
// escaneo de Producción: la caja sigue empacada y sus QRs, escaneados.
async function quitarCajaDeCartones(client, caja) {
  const { rows: cartones } = await client.query(
    `SELECT c.id, c.po_id, po.po_number, po.estado AS po_estado
       FROM cartones c
       JOIN purchase_orders po ON po.id = c.po_id
      WHERE c.id = $2
         OR c.id IN (SELECT e.carton_id FROM escaneos e
                      WHERE e.carton_id IS NOT NULL
                        AND e.codigo_qr_id IN (SELECT codigo_qr_id FROM escaneos WHERE caja_id = $1))`,
    [caja.id, caja.carton_id],
  );
  const enviada = cartones.find((c) => c.po_estado === "enviado");
  if (enviada)
    throw {
      status: 409,
      message: `Los pares de esta caja ya se enviaron a T4 en la PO ${enviada.po_number}: cancela el envío antes`,
    };

  const { rowCount: pares } = await client.query(
    `DELETE FROM escaneos
      WHERE carton_id IS NOT NULL
        AND codigo_qr_id IN (SELECT codigo_qr_id FROM escaneos WHERE caja_id = $1)`,
    [caja.id],
  );
  if (caja.carton_id)
    await client.query("UPDATE cajas SET carton_id = NULL WHERE id = $1", [caja.id]);
  await client.query(
    "UPDATE cartones SET estado = 'pendiente' WHERE id = ANY($1)",
    [cartones.map((c) => c.id)],
  );
  for (const po_id of new Set(cartones.map((c) => c.po_id)))
    await recalcularEstado(client, po_id);

  return {
    pares_quitados_de_cartones: pares,
    caja_desligada_de_carton: caja.carton_id ? "sí" : "no",
    cartones_afectados: cartones.length,
    pos: [...new Set(cartones.map((c) => c.po_number))].join(", ") || "—",
  };
}

// Desasociar: la caja deja sus cartones y queda lista para volver a asignarse
// (por ejemplo, si se va a abrir o corregir después de ligarla a una PO).
async function desasociarCaja(caja_id, auditoria) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT * FROM cajas WHERE id = $1 FOR UPDATE",
      [caja_id],
    );
    if (!rows[0]) throw { status: 404, message: "Caja no encontrada" };
    const resultado = await quitarCajaDeCartones(client, rows[0]);
    if (resultado.cartones_afectados === 0)
      throw { status: 409, message: "La caja no está en ningún cartón" };
    const respuesta = { caja_id: parseInt(caja_id), ...resultado };
    await registrar(client, auditoria, "desasociar_caja", rows[0].id, rows[0].codigo_caja, respuesta);
    await client.query("COMMIT");
    return respuesta;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reset completo de una caja:
// - Borra escaneos con caja_id
// - Resetea QRs a disponible
// - Resetea caja a abierta
// - Si estaba en un cartón, desliga la caja y resetea el cartón a pendiente
async function resetCaja(caja_id, auditoria) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: cajaRows } = await client.query(
      "SELECT * FROM cajas WHERE id = $1",
      [caja_id],
    );
    if (!cajaRows[0]) throw { status: 404, message: "Caja no encontrada" };
    const caja = cajaRows[0];

    // Primero sale de los cartones donde estén sus pares (también los
    // repartidos par por par o por PO), para no dejar QRs sueltos en cartones.
    await quitarCajaDeCartones(client, caja);

    // Resetear QRs escaneados en esta caja a disponible
    await client.query(
      `UPDATE codigos_qr SET estado = 'disponible'
       WHERE id IN (SELECT codigo_qr_id FROM escaneos WHERE caja_id = $1)`,
      [caja_id],
    );

    // Borrar escaneos de la caja
    const { rowCount } = await client.query(
      "DELETE FROM escaneos WHERE caja_id = $1",
      [caja_id],
    );

    // Resetear la caja
    await client.query(
      "UPDATE cajas SET estado = 'abierta', carton_id = NULL WHERE id = $1",
      [caja_id],
    );

    const respuesta = { escaneos_borrados: rowCount, caja_id: parseInt(caja_id) };
    await registrar(client, auditoria, "caja", caja.id, caja.codigo_caja, respuesta);
    await client.query("COMMIT");
    return respuesta;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reset de un cartón:
// - Borra escaneos con carton_id (musicales)
// - Resetea QRs de esos escaneos a escaneado (vuelven a producción)
// - Desliga todas las cajas del cartón y las resetea a empacada
// - Resetea el cartón a pendiente
async function resetCarton(carton_id, auditoria) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: cartonRows } = await client.query(
      `SELECT c.*, po.po_number, po.estado AS po_estado
         FROM cartones c JOIN purchase_orders po ON po.id = c.po_id
        WHERE c.id = $1`,
      [carton_id],
    );
    if (!cartonRows[0]) throw { status: 404, message: "Cartón no encontrado" };
    bloquearSiEnviada({ po_number: cartonRows[0].po_number, estado: cartonRows[0].po_estado });

    // Escaneos musicales (carton_id directo) → QRs vuelven a escaneado
    await client.query(
      `UPDATE codigos_qr SET estado = 'escaneado'
       WHERE id IN (SELECT codigo_qr_id FROM escaneos WHERE carton_id = $1)`,
      [carton_id],
    );

    const { rowCount: musicalBorrados } = await client.query(
      "DELETE FROM escaneos WHERE carton_id = $1",
      [carton_id],
    );

    // Cajas que estaban en este cartón → desligar y volver a empacada
    const { rowCount: cajasBorradas } = await client.query(
      "UPDATE cajas SET carton_id = NULL, estado = 'empacada' WHERE carton_id = $1",
      [carton_id],
    );

    // Resetear el cartón
    await client.query(
      "UPDATE cartones SET estado = 'pendiente' WHERE id = $1",
      [carton_id],
    );

    // La PO deja de estar completa si lo estaba.
    await recalcularEstado(client, cartonRows[0].po_id);

    const respuesta = {
      carton_id: parseInt(carton_id),
      escaneos_musicales_borrados: musicalBorrados,
      cajas_desligadas: cajasBorradas,
    };
    await registrar(client, auditoria, "carton", cartonRows[0].id, cartonRows[0].carton_id, respuesta);
    await client.query("COMMIT");
    return respuesta;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reset de una PO completa:
// - Reset de todos los cartones de la PO
// - Reset de todas las cajas de esos cartones
// - Resetea estado de la PO a pendiente
async function resetPO(po_id, auditoria) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: poRows } = await client.query(
      "SELECT * FROM purchase_orders WHERE id = $1",
      [po_id],
    );
    if (!poRows[0]) throw { status: 404, message: "PO no encontrada" };
    bloquearSiEnviada(poRows[0]);

    // Obtener todos los cartones de la PO
    const { rows: cartones } = await client.query(
      "SELECT id FROM cartones WHERE po_id = $1",
      [po_id],
    );
    const cartonIds = cartones.map((c) => c.id);

    let escaneosMusicales = 0;
    let cajasDesligadas = 0;
    let escaneosCajas = 0;

    if (cartonIds.length) {
      // Escaneos musicales → QRs a escaneado
      await client.query(
        `UPDATE codigos_qr SET estado = 'escaneado'
         WHERE id IN (SELECT codigo_qr_id FROM escaneos WHERE carton_id = ANY($1))`,
        [cartonIds],
      );
      const { rowCount: em } = await client.query(
        "DELETE FROM escaneos WHERE carton_id = ANY($1)",
        [cartonIds],
      );
      escaneosMusicales = em;

      // Cajas ligadas a esos cartones
      const { rows: cajas } = await client.query(
        "SELECT id FROM cajas WHERE carton_id = ANY($1)",
        [cartonIds],
      );
      const cajaIds = cajas.map((c) => c.id);

      if (cajaIds.length) {
        // QRs de esas cajas → disponible
        await client.query(
          `UPDATE codigos_qr SET estado = 'disponible'
           WHERE id IN (SELECT codigo_qr_id FROM escaneos WHERE caja_id = ANY($1))`,
          [cajaIds],
        );
        const { rowCount: ec } = await client.query(
          "DELETE FROM escaneos WHERE caja_id = ANY($1)",
          [cajaIds],
        );
        escaneosCajas = ec;

        // Resetear cajas
        await client.query(
          "UPDATE cajas SET estado = 'abierta', carton_id = NULL WHERE id = ANY($1)",
          [cajaIds],
        );
        cajasDesligadas = cajaIds.length;
      }

      // Resetear cartones
      await client.query(
        "UPDATE cartones SET estado = 'pendiente' WHERE id = ANY($1)",
        [cartonIds],
      );
    }

    // Resetear PO
    await client.query(
      "UPDATE purchase_orders SET estado = 'pendiente' WHERE id = $1",
      [po_id],
    );

    const respuesta = {
      po_id: parseInt(po_id),
      cartones_reseteados: cartonIds.length,
      cajas_desligadas: cajasDesligadas,
      escaneos_musicales_borrados: escaneosMusicales,
      escaneos_cajas_borrados: escaneosCajas,
    };
    await registrar(client, auditoria, "po", poRows[0].id, poRows[0].po_number, respuesta);
    await client.query("COMMIT");
    return respuesta;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Búsqueda para la pantalla de Reset: hasta 25 coincidencias por código (o por
// SKU / PO), sin el límite de "las más recientes" que tenían las listas.
// Sin texto devuelve las 25 más recientes.
async function buscar(tipo, q = "") {
  // Igual que al escanear: el lector con teclado en español cambia - por ' o {.
  const texto = String(q).replace(/['{]/g, "-").trim().toUpperCase();
  const patron = `%${texto.replace(/[\\%_]/g, (c) => "\\" + c)}%`;

  if (tipo === "caja") {
    const { rows } = await pool.query(
      `SELECT c.id, c.codigo_caja AS codigo, c.estado, c.cantidad_pares,
              s.sku_number,
              (SELECT COUNT(*) FROM escaneos e WHERE e.caja_id = c.id)::int AS escaneados,
              (SELECT COUNT(*) FROM escaneos e2
                WHERE e2.carton_id IS NOT NULL
                  AND e2.codigo_qr_id IN (SELECT codigo_qr_id FROM escaneos e WHERE e.caja_id = c.id))::int AS pares_en_cartones,
              (SELECT string_agg(DISTINCT po2.po_number, ', ')
                 FROM escaneos e2
                 JOIN cartones c2 ON c2.id = e2.carton_id
                 JOIN purchase_orders po2 ON po2.id = c2.po_id
                WHERE e2.codigo_qr_id IN (SELECT codigo_qr_id FROM escaneos e WHERE e.caja_id = c.id)) AS pos_por_par,
              ct.carton_id, po.po_number,
              to_char(c.created_at, 'YYYY-MM-DD HH24:MI') AS fecha
         FROM cajas c
         JOIN skus s ON s.id = c.sku_id
         LEFT JOIN cartones ct ON ct.id = c.carton_id
         LEFT JOIN purchase_orders po ON po.id = ct.po_id
        WHERE $1 = '%%' OR c.codigo_caja ILIKE $1 OR s.sku_number ILIKE $1
        ORDER BY c.created_at DESC
        LIMIT 25`,
      [patron],
    );
    return rows;
  }
  if (tipo === "carton") {
    const { rows } = await pool.query(
      `SELECT ct.id, ct.carton_id AS codigo, ct.tipo, ct.estado, po.po_number,
              (SELECT SUM(cd.cantidad_por_carton) FROM carton_detalles cd WHERE cd.carton_id = ct.id)::int AS pares_esperados
         FROM cartones ct
         JOIN purchase_orders po ON po.id = ct.po_id
        WHERE $1 = '%%' OR ct.carton_id ILIKE $1 OR po.po_number ILIKE $1
        ORDER BY po.created_at DESC, ct.carton_id
        LIMIT 25`,
      [patron],
    );
    return rows;
  }
  if (tipo === "po") {
    const { rows } = await pool.query(
      `SELECT po.id, po.po_number AS codigo, po.estado, po.cantidad_pares,
              COUNT(ct.id)::int AS total_cartones,
              (COUNT(ct.id) FILTER (WHERE ct.estado = 'completo'))::int AS cartones_completos
         FROM purchase_orders po
         LEFT JOIN cartones ct ON ct.po_id = po.id
        WHERE $1 = '%%' OR po.po_number ILIKE $1
        GROUP BY po.id
        ORDER BY po.created_at DESC
        LIMIT 25`,
      [patron],
    );
    return rows;
  }
  throw { status: 400, message: "Tipo de búsqueda no válido" };
}

// Reporte de reseteos (Reportes › Reseteos).
async function reporteReseteos(params = {}) {
  const { fecha_desde = "", fecha_hasta = "", tipo = "", page = 1, limit = 50, all = "0" } = params;
  const conditions = [];
  const qp = [];
  if (fecha_desde) {
    qp.push(fecha_desde);
    conditions.push(`r.created_at >= $${qp.length}::date`);
  }
  if (fecha_hasta) {
    qp.push(fecha_hasta);
    conditions.push(`r.created_at < $${qp.length}::date + 1`);
  }
  if (TIPOS[tipo]) {
    qp.push(tipo);
    conditions.push(`r.tipo = $${qp.length}`);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const select = `
    SELECT r.id, to_char(r.created_at, 'YYYY-MM-DD HH24:MI:SS') AS fecha_hora,
           r.tipo, r.codigo, r.motivo, r.comentario, r.resultado,
           s.nombre AS supervisor, u.nombre AS hecho_por, u.rol AS hecho_por_rol
      FROM reseteos r
      LEFT JOIN supervisores s ON s.id = r.supervisor_id
      LEFT JOIN users u ON u.id = r.hecho_por
      ${where}
     ORDER BY r.created_at DESC, r.id DESC`;
  const conTexto = (rows) =>
    rows.map((r) => ({
      ...r,
      tipo_texto: TIPOS[r.tipo] || r.tipo,
      motivo_texto: MOTIVOS[r.motivo] || r.motivo,
    }));

  if (String(all) === "1") {
    const { rows } = await pool.query(select, qp);
    return { data: conTexto(rows), total: rows.length, page: 1, pages: 1 };
  }
  const { rows: tot } = await pool.query(`SELECT COUNT(*)::int AS n FROM reseteos r ${where}`, qp);
  const lim = parseInt(limit) || 50;
  const pagina = parseInt(page) || 1;
  qp.push(lim, (pagina - 1) * lim);
  const { rows } = await pool.query(`${select} LIMIT $${qp.length - 1} OFFSET $${qp.length}`, qp);
  return {
    data: conTexto(rows),
    total: tot[0].n,
    page: pagina,
    pages: Math.max(1, Math.ceil(tot[0].n / lim)),
  };
}

module.exports = {
  MOTIVOS,
  resetCaja,
  resetCarton,
  resetPO,
  buscar,
  desasociarCaja,
  reporteReseteos,
};
