const pool = require("../config/database");
const { normalizeQR } = require("./scanValidationService");

/**
 * Actualiza el estado de la PO según el estado de sus cartones.
 * - Todos completos -> 'completo'
 * - Al menos uno completo -> 'en_proceso'
 * - No toca POs en estado 'enviado' o 'cancelado'
 */
async function actualizarEstadoPO(client, carton_id) {
  const { rows } = await client.query(
    `SELECT c.po_id,
       (SELECT COUNT(*) FROM cartones WHERE po_id = c.po_id) AS total,
       (SELECT COUNT(*) FROM cartones WHERE po_id = c.po_id AND estado = 'completo') AS completos
     FROM cartones c
     WHERE c.id = $1`,
    [carton_id],
  );
  if (!rows[0]) return;
  const { po_id, total, completos } = rows[0];
  const totalInt = parseInt(total);
  const completosInt = parseInt(completos);

  const { rows: poRows } = await client.query(
    "SELECT estado FROM purchase_orders WHERE id = $1",
    [po_id],
  );
  const estadoActual = poRows[0]?.estado;
  if (!estadoActual || estadoActual === "enviado" || estadoActual === "cancelado")
    return;

  let nuevoEstado = estadoActual;
  if (totalInt > 0 && completosInt === totalInt) nuevoEstado = "completo";
  else if (completosInt > 0) nuevoEstado = "en_proceso";

  if (nuevoEstado !== estadoActual) {
    await client.query(
      "UPDATE purchase_orders SET estado = $1 WHERE id = $2",
      [nuevoEstado, po_id],
    );
  }
}

async function asignarCajaACarton(caja_id, carton_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: cajaRows } = await client.query(
      "SELECT * FROM cajas WHERE id = $1",
      [caja_id],
    );
    const caja = cajaRows[0];
    if (!caja) throw { status: 404, message: "Caja no encontrada" };
    if (caja.estado !== "empacada")
      throw { status: 409, message: "La caja debe estar empacada" };
    if (caja.carton_id)
      throw { status: 409, message: "La caja ya está asignada a un cartón" };

    const { rows: cartonRows } = await client.query(
      "SELECT * FROM cartones WHERE id = $1",
      [carton_id],
    );
    const carton = cartonRows[0];
    if (!carton) throw { status: 404, message: "Cartón no encontrado" };
    if (carton.tipo !== "mono_sku")
      throw {
        status: 400,
        message: "Este endpoint solo es para cartones mono_sku",
      };
    if (carton.estado === "completo")
      throw { status: 409, message: "El cartón ya está completo" };

    const { rows: detalleRows } = await client.query(
      "SELECT sku_id FROM carton_detalles WHERE carton_id = $1",
      [carton_id],
    );
    if (detalleRows[0].sku_id !== caja.sku_id) {
      throw {
        status: 400,
        message: "El SKU de la caja no coincide con el SKU del cartón",
      };
    }

    await client.query("UPDATE cajas SET carton_id = $1 WHERE id = $2", [
      carton_id,
      caja_id,
    ]);
    await client.query("UPDATE cartones SET estado = $1 WHERE id = $2", [
      "completo",
      carton_id,
    ]);

    await actualizarEstadoPO(client, carton_id);

    await client.query("COMMIT");
    return {
      message: "Caja asignada al cartón correctamente",
      carton_id,
      caja_id,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function reasociarQRaMusical(carton_id, codigo_qr, user_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validar cartón
    const { rows: cartonRows } = await client.query(
      `SELECT c.*, 
        json_agg(json_build_object(
          'sku_id', cd.sku_id,
          'sku_number', s.sku_number,
          'cantidad_por_carton', cd.cantidad_por_carton
        )) AS detalles
       FROM cartones c
       JOIN carton_detalles cd ON cd.carton_id = c.id
       JOIN skus s ON s.id = cd.sku_id
       WHERE c.id = $1
       GROUP BY c.id`,
      [carton_id],
    );
    const carton = cartonRows[0];
    if (!carton) throw { status: 404, message: "Cartón no encontrado" };
    if (carton.estado === "completo")
      throw { status: 409, message: "El cartón ya está completo" };

    const totalEsperado = carton.detalles.reduce(
      (sum, d) => sum + d.cantidad_por_carton,
      0,
    );
    const esParcial = carton.tipo === "mono_sku" && totalEsperado < 12;
    if (carton.tipo !== "musical" && !esParcial)
      throw {
        status: 400,
        message:
          "Este endpoint es para cartones musicales o mono_sku parciales (<12 pares)",
      };

    // Validar QR
    const { rows: qrRows } = await client.query(
      `SELECT qr.*, s.sku_number 
       FROM codigos_qr qr
       JOIN skus s ON s.id = qr.sku_id
       WHERE qr.codigo_qr = $1`,
      [normalizeQR(codigo_qr)],
    );
    const qr = qrRows[0];
    if (!qr) throw { status: 404, message: "QR no encontrado" };
    if (qr.estado !== "escaneado")
      throw {
        status: 409,
        message: `El QR debe estar en estado escaneado, está: ${qr.estado}`,
      };

    // Validar que el SKU del QR pertenece a este cartón
    const detalle = carton.detalles.find((d) => d.sku_id === qr.sku_id);
    if (!detalle)
      throw {
        status: 400,
        message: `El SKU ${qr.sku_number} no pertenece a este cartón`,
      };

    // Validar que el QR no fue ya reasociado a ningún cartón
    const { rows: yaEnCarton } = await client.query(
      "SELECT id FROM escaneos WHERE codigo_qr_id = $1 AND carton_id IS NOT NULL",
      [qr.id],
    );
    if (yaEnCarton[0])
      throw { status: 409, message: "Este QR ya fue reasociado a un cartón" };

    // Validar que la caja del QR no esté asignada a un cartón mono
    const { rows: cajaDelQR } = await client.query(
      `SELECT c.carton_id FROM escaneos e
       JOIN cajas c ON c.id = e.caja_id
       WHERE e.codigo_qr_id = $1 AND e.caja_id IS NOT NULL`,
      [qr.id],
    );
    if (cajaDelQR[0]?.carton_id)
      throw { status: 409, message: "Este QR pertenece a una caja ya asignada a otro cartón" };

    // Contar cuántos QRs de este SKU ya están en el cartón musical
    const { rows: conteo } = await client.query(
      `SELECT COUNT(*) AS total
       FROM escaneos e
       JOIN codigos_qr q ON q.id = e.codigo_qr_id
       WHERE e.carton_id = $1 AND q.sku_id = $2`,
      [carton_id, qr.sku_id],
    );
    const yaReasociados = parseInt(conteo[0].total);
    if (yaReasociados >= detalle.cantidad_por_carton) {
      throw {
        status: 409,
        message: `Ya se completaron los ${detalle.cantidad_por_carton} pares de SKU ${detalle.sku_number} en este cartón`,
      };
    }

    // Insertar escaneo de reasociación (carton_id, sin caja_id)
    await client.query(
      "INSERT INTO escaneos (carton_id, codigo_qr_id, created_by) VALUES ($1, $2, $3)",
      [carton_id, qr.id, user_id],
    );

    // Verificar si el cartón está completo
    const { rows: totalRows } = await client.query(
      "SELECT COUNT(*) AS total FROM escaneos WHERE carton_id = $1",
      [carton_id],
    );
    const totalReasociados = parseInt(totalRows[0].total);

    if (totalReasociados >= totalEsperado) {
      await client.query("UPDATE cartones SET estado = $1 WHERE id = $2", [
        "completo",
        carton_id,
      ]);
      await actualizarEstadoPO(client, carton_id);
    }

    await client.query("COMMIT");

    return {
      qr: qr.codigo_qr,
      sku: qr.sku_number,
      reasociados: totalReasociados,
      total: totalEsperado,
      completo: totalReasociados >= totalEsperado,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getCarton(carton_id) {
  const { rows } = await pool.query(
    `SELECT c.*, po.po_number,
      json_agg(DISTINCT jsonb_build_object(
        'sku_id', cd.sku_id,
        'sku_number', s.sku_number,
        'cantidad_esperada', cd.cantidad_por_carton
      )) AS detalles
     FROM cartones c
     JOIN purchase_orders po ON po.id = c.po_id
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.id = $1
     GROUP BY c.id, po.po_number`,
    [carton_id],
  );
  if (!rows[0]) throw { status: 404, message: "Cartón no encontrado" };
  return rows[0];
}

async function getCartonesPorPO(po_id) {
  const { rows } = await pool.query(
    `SELECT c.*,
      json_agg(DISTINCT jsonb_build_object(
        'sku_number', s.sku_number,
        'cantidad_esperada', cd.cantidad_por_carton
      )) AS detalles
     FROM cartones c
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.po_id = $1
     GROUP BY c.id
     ORDER BY c.carton_id`,
    [po_id],
  );
  return rows;
}

async function getProgresoMusical(carton_id) {
  const { rows: cartonRows } = await pool.query(
    `SELECT c.*,
      json_agg(DISTINCT jsonb_build_object(
        'sku_id', cd.sku_id,
        'sku_number', s.sku_number,
        'cantidad_esperada', cd.cantidad_por_carton
      )) AS detalles
     FROM cartones c
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.id = $1
     GROUP BY c.id`,
    [carton_id],
  );
  if (!cartonRows[0]) throw { status: 404, message: "Cartón no encontrado" };
  const carton = cartonRows[0];

  const { rows: porSku } = await pool.query(
    `SELECT s.sku_number, s.id AS sku_id, COUNT(e.id) AS reasociados
     FROM escaneos e
     JOIN codigos_qr q ON q.id = e.codigo_qr_id
     JOIN skus s ON s.id = q.sku_id
     WHERE e.carton_id = $1
     GROUP BY s.id`,
    [carton_id],
  );

  return { carton, progreso_por_sku: porSku };
}

async function buscarCarton(codigo) {
  const codigoNormalizado = codigo.replace(/'/g, "-");
  const { rows } = await pool.query(
    `SELECT c.*, po.po_number,
      json_agg(DISTINCT jsonb_build_object(
        'sku_id', cd.sku_id,
        'sku_number', s.sku_number,
        'cantidad_esperada', cd.cantidad_por_carton
      )) AS detalles
     FROM cartones c
     JOIN purchase_orders po ON po.id = c.po_id
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.carton_id = $1
     GROUP BY c.id, po.po_number`,
    [codigoNormalizado],
  );
  if (!rows[0]) throw { status: 404, message: "Cartón no encontrado" };
  return rows[0];
}

module.exports = {
  asignarCajaACarton,
  reasociarQRaMusical,
  getCarton,
  getCartonesPorPO,
  getProgresoMusical,
  buscarCarton,
  actualizarEstadoPO,
};
