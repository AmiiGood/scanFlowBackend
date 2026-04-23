const pool = require("../config/database");
const { normalizeQR } = require("./scanValidationService");

async function resumenGeneral() {
  const { rows: pos } = await pool.query(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE estado = 'pendiente') AS pendientes,
      COUNT(*) FILTER (WHERE estado = 'en_proceso') AS en_proceso,
      COUNT(*) FILTER (WHERE estado = 'completo') AS completas,
      COUNT(*) FILTER (WHERE estado = 'enviado') AS enviadas,
      COUNT(*) FILTER (WHERE estado = 'cancelado') AS canceladas
     FROM purchase_orders`,
  );

  const { rows: cartones } = await pool.query(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE estado = 'pendiente') AS pendientes,
      COUNT(*) FILTER (WHERE estado = 'en_proceso') AS en_proceso,
      COUNT(*) FILTER (WHERE estado = 'completo') AS completos
     FROM cartones`,
  );

  const { rows: cajas } = await pool.query(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE estado = 'abierta') AS abiertas,
      COUNT(*) FILTER (WHERE estado = 'empacada') AS empacadas
     FROM cajas`,
  );

  const { rows: qrs } = await pool.query(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE estado = 'disponible') AS disponibles,
      COUNT(*) FILTER (WHERE estado = 'escaneado') AS escaneados,
      COUNT(*) FILTER (WHERE estado = 'enviado') AS enviados
     FROM codigos_qr`,
  );

  return {
    purchase_orders: pos[0],
    cartones: cartones[0],
    cajas: cajas[0],
    qrs: qrs[0],
  };
}

async function progresoPorPO(po_id) {
  const { rows: poRows } = await pool.query(
    "SELECT * FROM purchase_orders WHERE id = $1",
    [po_id],
  );
  if (!poRows[0]) throw { status: 404, message: "PO no encontrada" };

  const { rows: cartones } = await pool.query(
    `SELECT c.id, c.carton_id, c.tipo, c.estado,
      COUNT(DISTINCT cd.sku_id) AS skus_distintos,
      SUM(cd.cantidad_por_carton) AS pares_esperados,
      (
        SELECT COUNT(*) FROM escaneos e
        JOIN cajas ca ON ca.id = e.caja_id
        WHERE ca.carton_id = c.id
      ) +
      (
        SELECT COUNT(*) FROM escaneos e
        WHERE e.caja_id = c.id
      ) AS pares_escaneados
     FROM cartones c
     JOIN carton_detalles cd ON cd.carton_id = c.id
     WHERE c.po_id = $1
     GROUP BY c.id
     ORDER BY c.carton_id`,
    [po_id],
  );

  const total = cartones.length;
  const completos = cartones.filter((c) => c.estado === "completo").length;

  return {
    po: poRows[0],
    progreso: { total, completos, pendientes: total - completos },
    cartones,
  };
}

async function actividadReciente(limite = 50) {
  const { rows: escaneos } = await pool.query(
    `SELECT
      e.created_at,
      u.nombre AS operador,
      qr.codigo_qr,
      s.sku_number,
      ca.codigo_caja,
      ca.estado AS caja_estado
     FROM escaneos e
     JOIN users u ON u.id = e.created_by
     JOIN codigos_qr qr ON qr.id = e.codigo_qr_id
     JOIN skus s ON s.id = qr.sku_id
     LEFT JOIN cajas ca ON ca.id = e.caja_id
     ORDER BY e.created_at DESC
     LIMIT $1`,
    [limite],
  );
  return escaneos;
}

async function produccionPorOperador() {
  const { rows } = await pool.query(
    `SELECT
      u.id,
      u.nombre,
      u.rol,
      (SELECT COUNT(*) FROM cajas WHERE created_by = u.id) AS cajas_iniciadas,
      (SELECT COUNT(*) FROM escaneos WHERE created_by = u.id AND caja_id IS NOT NULL) AS qrs_escaneados,
      (SELECT MAX(created_at) FROM escaneos WHERE created_by = u.id AND caja_id IS NOT NULL) AS ultimo_escaneo
     FROM users u
     WHERE u.rol = 'operador_produccion'
     ORDER BY qrs_escaneados DESC`,
  );
  return rows;
}

async function skusSinQRs() {
  const { rows } = await pool.query(
    `SELECT s.sku_number, s.upc, s.style_name,
      COUNT(qr.id) AS qrs_disponibles
     FROM skus s
     LEFT JOIN codigos_qr qr ON qr.sku_id = s.id AND qr.estado = 'disponible'
     GROUP BY s.id
     HAVING COUNT(qr.id) = 0
     ORDER BY s.sku_number`,
  );
  return rows;
}

async function produccionPorDia(dias = 30) {
  const { rows } = await pool.query(
    `SELECT
      DATE(e.created_at) AS fecha,
      COUNT(e.id) AS qrs_escaneados,
      COUNT(DISTINCT e.caja_id) AS cajas_trabajadas,
      COUNT(DISTINCT e.created_by) AS operadores_activos
     FROM escaneos e
     WHERE e.created_at >= NOW() - INTERVAL '${parseInt(dias)} days'
       AND e.caja_id IS NOT NULL
     GROUP BY DATE(e.created_at)
     ORDER BY fecha DESC`,
  );
  return rows;
}

async function trazabilidadQR(codigo_qr) {
  const normalizado = normalizeQR(codigo_qr.trim());
  const sufijo = normalizado.includes("/")
    ? normalizado.split("/").pop()
    : normalizado;

  const { rows: qrRows } = await pool.query(
    `SELECT
      qr.id, qr.codigo_qr, qr.upc, qr.estado, qr.created_at,
      s.sku_number, s.style_no, s.style_name, s.size, s.color, s.color_name
     FROM codigos_qr qr
     LEFT JOIN skus s ON s.id = qr.sku_id
     WHERE qr.codigo_qr = $1
        OR qr.codigo_qr = $2
        OR qr.codigo_qr LIKE '%/' || $3`,
    [codigo_qr, normalizado, sufijo],
  );
  if (!qrRows[0]) throw { status: 404, message: "QR no encontrado" };
  const qr = qrRows[0];

  const { rows: escaneos } = await pool.query(
    `SELECT
       e.id, e.created_at AS escaneado_at,
       u.nombre AS escaneado_por,
       ca.codigo_caja, ca.estado AS caja_estado,
       c.carton_id, c.tipo AS carton_tipo, c.estado AS carton_estado,
       po.id AS po_id, po.po_number, po.estado AS po_estado,
       to_char(po.cfm_xf_date, 'YYYY-MM-DD') AS cfm_xf_date
     FROM escaneos e
     LEFT JOIN users u ON u.id = e.created_by
     LEFT JOIN cajas ca ON ca.id = e.caja_id
     LEFT JOIN cartones c ON c.id = COALESCE(ca.carton_id, e.carton_id)
     LEFT JOIN purchase_orders po ON po.id = c.po_id
     WHERE e.codigo_qr_id = $1
     ORDER BY e.created_at DESC`,
    [qr.id],
  );

  const { rows: envios } = await pool.query(
    `SELECT et.estado, et.enviado_at, et.cancelado_at
     FROM envios_trysor et
     WHERE et.po_id IN (
       SELECT DISTINCT po.id FROM escaneos e
       LEFT JOIN cajas ca ON ca.id = e.caja_id
       LEFT JOIN cartones c ON c.id = COALESCE(ca.carton_id, e.carton_id)
       LEFT JOIN purchase_orders po ON po.id = c.po_id
       WHERE e.codigo_qr_id = $1 AND po.id IS NOT NULL
     )
     ORDER BY et.created_at DESC`,
    [qr.id],
  );

  const principal = escaneos[0] || {};
  return {
    ...qr,
    ...principal,
    escaneos,
    envios,
    total_escaneos: escaneos.length,
  };
}

async function cajasPorSKU(params = {}) {
  const {
    sku = "",
    estado = "",
    po_number = "",
    operador = "",
    fecha_desde = "",
    fecha_hasta = "",
    page = 1,
    limit = 50,
    all = "0",
  } = params;

  const conditions = [];
  const qp = [];

  if (sku) {
    qp.push(`%${sku}%`);
    conditions.push("s.sku_number ILIKE $" + qp.length);
  }
  if (estado) {
    qp.push(estado);
    conditions.push("ca.estado = $" + qp.length);
  }
  if (po_number) {
    qp.push(`%${po_number}%`);
    conditions.push(
      "EXISTS (SELECT 1 FROM cartones c JOIN purchase_orders po ON po.id = c.po_id WHERE c.id = ca.carton_id AND po.po_number ILIKE $" +
        qp.length +
        ")",
    );
  }
  if (operador) {
    qp.push(`%${operador}%`);
    conditions.push("u.nombre ILIKE $" + qp.length);
  }
  if (fecha_desde) {
    qp.push(fecha_desde);
    conditions.push("ca.created_at >= $" + qp.length);
  }
  if (fecha_hasta) {
    qp.push(fecha_hasta);
    conditions.push(
      "ca.created_at <= $" + qp.length + "::date + INTERVAL '1 day'",
    );
  }

  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const baseSelect = `
    SELECT
      ca.id, ca.codigo_caja, ca.estado, ca.cantidad_pares, ca.created_at,
      s.sku_number, s.style_name, s.size, s.color_name,
      COUNT(e.id) AS qrs_escaneados,
      u.nombre AS creado_por,
      (SELECT po.po_number FROM cartones c
         JOIN purchase_orders po ON po.id = c.po_id
         WHERE c.id = ca.carton_id LIMIT 1) AS po_number,
      (SELECT c.carton_id FROM cartones c WHERE c.id = ca.carton_id LIMIT 1) AS carton_id
    FROM cajas ca
    JOIN skus s ON s.id = ca.sku_id
    LEFT JOIN escaneos e ON e.caja_id = ca.id
    LEFT JOIN users u ON u.id = ca.created_by
    ${where}
    GROUP BY ca.id, s.sku_number, s.style_name, s.size, s.color_name, u.nombre
    ORDER BY ca.created_at DESC`;

  if (String(all) === "1") {
    const { rows } = await pool.query(baseSelect, qp);
    return { data: rows, total: rows.length, page: 1, pages: 1 };
  }

  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) FROM cajas ca
     JOIN skus s ON s.id = ca.sku_id
     LEFT JOIN users u ON u.id = ca.created_by
     ${where}`,
    qp,
  );

  const offset = (parseInt(page) - 1) * parseInt(limit);
  qp.push(parseInt(limit), offset);
  const limitIdx = qp.length - 1;
  const offsetIdx = qp.length;
  const { rows } = await pool.query(
    baseSelect + " LIMIT $" + limitIdx + " OFFSET $" + offsetIdx,
    qp,
  );

  return {
    data: rows,
    total: parseInt(totalRows[0].count),
    page: parseInt(page),
    pages: Math.ceil(parseInt(totalRows[0].count) / parseInt(limit)),
  };
}

async function cartonesPendientesPorPO(po_id) {
  const { rows: poRows } = await pool.query(
    "SELECT * FROM purchase_orders WHERE id = $1",
    [po_id],
  );
  if (!poRows[0]) throw { status: 404, message: "PO no encontrada" };

  const { rows } = await pool.query(
    `SELECT
      c.id, c.carton_id, c.tipo, c.estado,
      json_agg(DISTINCT jsonb_build_object(
        'sku_number', s.sku_number,
        'style_name', s.style_name,
        'size', s.size,
        'color_name', s.color_name,
        'cantidad_esperada', cd.cantidad_por_carton,
        'cantidad_actual', (
          SELECT COUNT(*) FROM escaneos e2
          JOIN codigos_qr q2 ON q2.id = e2.codigo_qr_id
          WHERE (e2.caja_id IN (SELECT id FROM cajas WHERE carton_id = c.id)
            OR e2.carton_id = c.id)
            AND q2.sku_id = cd.sku_id
        )
      )) AS detalles,
      SUM(cd.cantidad_por_carton) AS pares_esperados,
      (
        SELECT COUNT(*) FROM escaneos e
        LEFT JOIN cajas ca ON ca.id = e.caja_id
        WHERE ca.carton_id = c.id OR e.carton_id = c.id
      ) AS pares_escaneados
     FROM cartones c
     JOIN carton_detalles cd ON cd.carton_id = c.id
     JOIN skus s ON s.id = cd.sku_id
     WHERE c.po_id = $1 AND c.estado != 'completo'
     GROUP BY c.id
     ORDER BY c.carton_id`,
    [po_id],
  );

  return { po: poRows[0], cartones_pendientes: rows };
}

async function qrsSinSKU(params = {}) {
  const { page = 1, limit = 100 } = params;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { rows: total } = await pool.query(
    "SELECT COUNT(*) FROM codigos_qr WHERE sku_id IS NULL",
  );

  const { rows } = await pool.query(
    `SELECT id, codigo_qr, upc, estado, created_at
     FROM codigos_qr
     WHERE sku_id IS NULL
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [parseInt(limit), offset],
  );

  return {
    data: rows,
    total: parseInt(total[0].count),
    page: parseInt(page),
    pages: Math.ceil(parseInt(total[0].count) / parseInt(limit)),
  };
}

async function historialEnviosT4() {
  const { rows } = await pool.query(
    `SELECT
      et.id, et.estado, et.enviado_at, et.cancelado_at, et.created_at,
      po.id AS po_id, po.po_number, po.cantidad_pares, po.cantidad_cartones,
      to_char(po.cfm_xf_date, 'YYYY-MM-DD') AS cfm_xf_date,
      (SELECT COUNT(*) FROM cartones WHERE po_id = po.id) AS total_cartones,
      (
        SELECT COUNT(DISTINCT e.codigo_qr_id)
        FROM escaneos e
        LEFT JOIN cajas ca ON ca.id = e.caja_id
        WHERE ca.carton_id IN (SELECT id FROM cartones WHERE po_id = po.id)
           OR e.carton_id IN (SELECT id FROM cartones WHERE po_id = po.id)
      ) AS qrs_asociados,
      et.respuesta_api->>'message' AS respuesta_mensaje,
      et.respuesta_api->>'success' AS respuesta_success,
      et.respuesta_api->>'errorCode' AS respuesta_error_code,
      et.respuesta_api
     FROM envios_trysor et
     JOIN purchase_orders po ON po.id = et.po_id
     ORDER BY et.created_at DESC`,
  );
  return rows;
}

async function detalleCartonesPorPO(po_id) {
  const { rows: poRows } = await pool.query(
    `SELECT id, po_number, cantidad_pares, cantidad_cartones,
            to_char(cfm_xf_date, 'YYYY-MM-DD') AS cfm_xf_date, estado
     FROM purchase_orders WHERE id = $1`,
    [po_id],
  );
  if (!poRows[0]) throw { status: 404, message: "PO no encontrada" };

  const { rows } = await pool.query(
    `SELECT
       po.po_number,
       c.carton_id, c.tipo AS carton_tipo, c.estado AS carton_estado,
       ca.codigo_caja, ca.estado AS caja_estado, ca.cantidad_pares AS caja_pares,
       s.sku_number, s.style_no, s.style_name, s.size, s.color, s.color_name,
       cq.codigo_qr, cq.upc, cq.estado AS qr_estado,
       u.nombre AS escaneado_por,
       e.created_at AS escaneado_at
     FROM escaneos e
     LEFT JOIN cajas ca ON ca.id = e.caja_id
     JOIN cartones c ON c.id = COALESCE(ca.carton_id, e.carton_id)
     JOIN purchase_orders po ON po.id = c.po_id
     LEFT JOIN codigos_qr cq ON cq.id = e.codigo_qr_id
     LEFT JOIN skus s ON s.id = cq.sku_id
     LEFT JOIN users u ON u.id = e.created_by
     WHERE c.po_id = $1
     ORDER BY c.carton_id, ca.codigo_caja NULLS LAST, cq.codigo_qr`,
    [po_id],
  );

  return { po: poRows[0], detalles: rows, total: rows.length };
}

module.exports = {
  resumenGeneral,
  progresoPorPO,
  actividadReciente,
  produccionPorOperador,
  skusSinQRs,
  produccionPorDia,
  trazabilidadQR,
  cajasPorSKU,
  cartonesPendientesPorPO,
  qrsSinSKU,
  historialEnviosT4,
  detalleCartonesPorPO,
};
