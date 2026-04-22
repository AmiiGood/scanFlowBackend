const pool = require("../config/database");
const t4ApiService = require("./t4ApiService");

async function enviarPOaT4(po_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: poRows } = await client.query(
      `SELECT id, po_number, estado,
              to_char(cfm_xf_date, 'YYYY-MM-DD') AS cfm_xf_date
       FROM purchase_orders WHERE id = $1`,
      [po_id],
    );
    const po = poRows[0];
    if (!po) throw { status: 404, message: "PO no encontrada" };
    if (po.estado === "enviado")
      throw { status: 409, message: "La PO ya fue enviada" };
    if (po.estado === "cancelado")
      throw { status: 409, message: "La PO está cancelada" };

    // Verificar que todos los cartones estén completos
    const { rows: cartonStats } = await client.query(
      `SELECT 
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE estado = 'completo') AS completos
       FROM cartones WHERE po_id = $1`,
      [po_id],
    );

    const { total, completos } = cartonStats[0];
    if (parseInt(total) === 0)
      throw { status: 400, message: "La PO no tiene cartones" };
    if (parseInt(total) !== parseInt(completos)) {
      throw {
        status: 409,
        message: `Faltan cartones por completar: ${completos}/${total} completos`,
      };
    }

    // Obtener SKUs con sus códigos QR escaneados en esta PO
    const { rows: skusConCodigos } = await client.query(
      `SELECT
         s.sku_number, s.style_no, s.style_name,
         s.color, s.color_name, s.size,
         array_agg(DISTINCT cq.codigo_qr) AS codes
       FROM codigos_qr cq
       JOIN skus s ON s.id = cq.sku_id
       WHERE cq.id IN (
         SELECT e.codigo_qr_id FROM escaneos e
         JOIN cajas ca ON ca.id = e.caja_id
         JOIN cartones c ON c.id = ca.carton_id
         WHERE c.po_id = $1
         UNION
         SELECT e.codigo_qr_id FROM escaneos e
         JOIN cartones c ON c.id = e.carton_id
         WHERE c.po_id = $1
       )
       GROUP BY s.id, s.sku_number, s.style_no, s.style_name,
                s.color, s.color_name, s.size`,
      [po_id],
    );

    if (!skusConCodigos.length)
      throw { status: 400, message: "La PO no tiene códigos QR escaneados" };

    const respuesta = await t4ApiService.enviarPO(po, skusConCodigos);

    // Registrar envío
    await client.query(
      `INSERT INTO envios_trysor (po_id, estado, respuesta_api, enviado_at)
       VALUES ($1, 'enviado', $2, NOW())`,
      [po_id, JSON.stringify(respuesta)],
    );

    await client.query(
      `UPDATE purchase_orders SET estado = 'enviado' WHERE id = $1`,
      [po_id],
    );

    // Marcar QRs como enviados
    await client.query(
      `UPDATE codigos_qr SET estado = 'enviado'
   WHERE id IN (
     SELECT e.codigo_qr_id FROM escaneos e
     JOIN cajas ca ON ca.id = e.caja_id
     JOIN cartones c ON c.id = ca.carton_id
     WHERE c.po_id = $1
     UNION
     SELECT e.codigo_qr_id FROM escaneos e
     JOIN cartones c ON c.id = e.carton_id
     WHERE c.po_id = $1
   )`,
      [po_id],
    );

    await client.query("COMMIT");
    return { message: "PO enviada correctamente", respuesta };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function cancelarPOenT4(po_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: poRows } = await client.query(
      "SELECT * FROM purchase_orders WHERE id = $1",
      [po_id],
    );
    const po = poRows[0];
    if (!po) throw { status: 404, message: "PO no encontrada" };
    if (po.estado !== "enviado")
      throw {
        status: 409,
        message: "Solo se pueden cancelar POs en estado enviado",
      };

    // Obtener todos los códigos QR asociados a esta PO
    const { rows: codesRows } = await client.query(
      `SELECT cq.codigo_qr
       FROM codigos_qr cq
       WHERE cq.id IN (
         SELECT e.codigo_qr_id FROM escaneos e
         JOIN cajas ca ON ca.id = e.caja_id
         JOIN cartones c ON c.id = ca.carton_id
         WHERE c.po_id = $1
         UNION
         SELECT e.codigo_qr_id FROM escaneos e
         JOIN cartones c ON c.id = e.carton_id
         WHERE c.po_id = $1
       )`,
      [po_id],
    );

    const codes = codesRows.map((r) => r.codigo_qr);
    if (!codes.length)
      throw { status: 400, message: "La PO no tiene códigos QR para cancelar" };

    const respuesta = await t4ApiService.cancelarPO(codes);

    await client.query(
      `INSERT INTO envios_trysor (po_id, estado, respuesta_api, cancelado_at)
       VALUES ($1, 'cancelado', $2, NOW())`,
      [po_id, JSON.stringify(respuesta)],
    );

    await client.query(
      `UPDATE purchase_orders SET estado = 'cancelado' WHERE id = $1`,
      [po_id],
    );

    // Revertir QRs a escaneado
    await client.query(
      `UPDATE codigos_qr SET estado = 'escaneado'
   WHERE id IN (
     SELECT e.codigo_qr_id FROM escaneos e
     JOIN cajas ca ON ca.id = e.caja_id
     JOIN cartones c ON c.id = ca.carton_id
     WHERE c.po_id = $1
     UNION
     SELECT e.codigo_qr_id FROM escaneos e
     JOIN cartones c ON c.id = e.carton_id
     WHERE c.po_id = $1
   )`,
      [po_id],
    );

    await client.query("COMMIT");
    return { message: "PO cancelada correctamente", respuesta };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getHistorialEnvios(po_id) {
  const { rows } = await pool.query(
    `SELECT * FROM envios_trysor WHERE po_id = $1 ORDER BY created_at DESC`,
    [po_id],
  );
  return rows;
}

module.exports = { enviarPOaT4, cancelarPOenT4, getHistorialEnvios };
