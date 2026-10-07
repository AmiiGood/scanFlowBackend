const pool = require("../config/database");
const { normalizeQR } = require("./scanValidationService");

// Los TIMESTAMP de ScanFlow guardan la hora local de planta. Se entregan como
// texto para que ni el servidor ni el navegador los muevan de zona horaria.
const fechaHora = (col) => `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS')`;
// "Hoy" en planta; CURRENT_DATE va en la zona de la sesión (GMT en el servidor).
const HOY_LOCAL = "(now() AT TIME ZONE 'America/Mexico_City')::date";
const AHORA_LOCAL = "(now() AT TIME ZONE 'America/Mexico_City')";

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
        WHERE e.carton_id = c.id
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

// Por día: pares escaneados en Producción, cajas que se abrieron y cajas que
// se cerraron (empacadas; la hora de cierre es la de su último par).
async function produccionPorDia(dias = 30) {
  const { rows } = await pool.query(
    `WITH desde AS (SELECT ${HOY_LOCAL} - ($1::int - 1) AS d),
     qrs AS (
       SELECT e.created_at::date AS fecha,
              COUNT(*) AS qrs_escaneados,
              COUNT(DISTINCT e.created_by) AS operadores_activos
         FROM escaneos e, desde
        WHERE e.caja_id IS NOT NULL AND e.created_at >= desde.d
        GROUP BY 1
     ),
     abiertas AS (
       SELECT ca.created_at::date AS fecha, COUNT(*) AS cajas_abiertas
         FROM cajas ca, desde
        WHERE ca.created_at >= desde.d
        GROUP BY 1
     ),
     cerradas AS (
       SELECT t.cerrada_at::date AS fecha, COUNT(*) AS cajas_cerradas
         FROM (SELECT e.caja_id, MAX(e.created_at) AS cerrada_at
                 FROM escaneos e
                 JOIN cajas ca ON ca.id = e.caja_id AND ca.estado = 'empacada'
                GROUP BY e.caja_id) t, desde
        WHERE t.cerrada_at >= desde.d
        GROUP BY 1
     ),
     fechas AS (
       SELECT fecha FROM qrs UNION SELECT fecha FROM abiertas
       UNION SELECT fecha FROM cerradas
     )
     SELECT to_char(f.fecha, 'YYYY-MM-DD') AS fecha,
            COALESCE(q.qrs_escaneados, 0) AS qrs_escaneados,
            COALESCE(a.cajas_abiertas, 0) AS cajas_abiertas,
            COALESCE(c.cajas_cerradas, 0) AS cajas_cerradas,
            COALESCE(q.operadores_activos, 0) AS operadores_activos
       FROM fechas f
       LEFT JOIN qrs q ON q.fecha = f.fecha
       LEFT JOIN abiertas a ON a.fecha = f.fecha
       LEFT JOIN cerradas c ON c.fecha = f.fecha
      ORDER BY f.fecha DESC`,
    [parseInt(dias) || 30],
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
      ca.id, ca.codigo_caja, ca.estado, ca.cantidad_pares,
      ${fechaHora("ca.created_at")} AS fecha_hora,
      s.sku_number, s.style_name, s.size, s.color_name,
      COUNT(e.id) AS qrs_escaneados,
      (SELECT po.po_number FROM cartones c
         JOIN purchase_orders po ON po.id = c.po_id
         WHERE c.id = ca.carton_id LIMIT 1) AS po_number,
      (SELECT c.carton_id FROM cartones c WHERE c.id = ca.carton_id LIMIT 1) AS carton_id
    FROM cajas ca
    JOIN skus s ON s.id = ca.sku_id
    LEFT JOIN escaneos e ON e.caja_id = ca.id
    ${where}
    GROUP BY ca.id, s.sku_number, s.style_name, s.size, s.color_name
    ORDER BY ca.created_at DESC`;

  if (String(all) === "1") {
    const { rows } = await pool.query(baseSelect, qp);
    return { data: rows, total: rows.length, page: 1, pages: 1 };
  }

  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) FROM cajas ca
     JOIN skus s ON s.id = ca.sku_id
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
        JOIN cajas ca ON ca.id = e.caja_id
        WHERE ca.carton_id = c.id
      ) + (
        SELECT COUNT(*) FROM escaneos e WHERE e.carton_id = c.id
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

// QRs sin SKU agrupados por UPC, con lo que hace falta para cada uno:
//   ya_esta_en_skus     → el SKU ya se cargó; solo falta "Vincular QRs huérfanos"
//   coincide_sin_ceros  → existe con distinta cantidad de ceros a la izquierda
//   ninguno             → falta cargar el SKU
async function qrsSinSKUPorUPC() {
  const { rows } = await pool.query(
    `SELECT q.upc,
            COUNT(*)::int AS qrs,
            (COUNT(*) FILTER (WHERE q.estado = 'disponible'))::int AS disponibles,
            to_char(MIN(q.created_at), 'YYYY-MM-DD') AS primer_import,
            to_char(MAX(q.created_at), 'YYYY-MM-DD') AS ultimo_import,
            EXISTS (SELECT 1 FROM skus s WHERE s.upc = q.upc) AS ya_esta_en_skus,
            (SELECT s.upc FROM skus s
              WHERE ltrim(s.upc, '0') = ltrim(q.upc, '0') AND s.upc <> q.upc
              LIMIT 1) AS upc_en_skus
       FROM codigos_qr q
      WHERE q.sku_id IS NULL
      GROUP BY q.upc
      ORDER BY qrs DESC`,
  );
  return {
    total_upcs: rows.length,
    total_qrs: rows.reduce((a, r) => a + r.qrs, 0),
    data: rows,
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

// Todo lo que muestra el Dashboard en una sola llamada. Se refresca seguido,
// así que solo usa consultas que van por índice (el inventario de QRs, que
// cuenta 1.3 M de filas, va aparte en resumenGeneral).
async function dashboard() {
  const [hoy, porHora, incompletas, pos, actividad] = await Promise.all([
    pool.query(
      `SELECT
         (SELECT COUNT(*) FROM escaneos
           WHERE caja_id IS NOT NULL AND created_at >= ${HOY_LOCAL}) AS pares_hoy,
         (SELECT COUNT(*) FROM escaneos
           WHERE caja_id IS NOT NULL AND created_at >= ${HOY_LOCAL} - 1
             AND created_at < ${AHORA_LOCAL} - interval '1 day') AS pares_ayer_misma_hora,
         (SELECT COUNT(*) FROM cajas WHERE created_at >= ${HOY_LOCAL}) AS cajas_abiertas_hoy,
         (SELECT COUNT(*) FROM (
            SELECT e.caja_id FROM escaneos e
              JOIN cajas ca ON ca.id = e.caja_id AND ca.estado = 'empacada'
             WHERE e.created_at >= ${HOY_LOCAL} - 1
             GROUP BY e.caja_id
            HAVING MAX(e.created_at) >= ${HOY_LOCAL}) t) AS cajas_cerradas_hoy,
         (SELECT ${fechaHora("MAX(created_at)")} FROM escaneos) AS ultima_lectura,
         (SELECT COUNT(*) FROM purchase_orders WHERE estado = 'completo') AS pos_listas,
         (SELECT COUNT(*) FROM purchase_orders WHERE estado = 'en_proceso') AS pos_en_proceso,
         ${fechaHora(AHORA_LOCAL)} AS ahora`,
    ),
    // Pares por hora de hoy contra el promedio de esa hora en los 14 días
    // anteriores con producción (los días sin actividad no bajan el promedio).
    pool.query(
      `WITH previos AS (
         SELECT created_at::date AS dia, EXTRACT(HOUR FROM created_at)::int AS hora, COUNT(*) AS n
           FROM escaneos
          WHERE caja_id IS NOT NULL
            AND created_at >= ${HOY_LOCAL} - 14 AND created_at < ${HOY_LOCAL}
          GROUP BY 1, 2
       ),
       dias AS (SELECT COUNT(DISTINCT dia) AS d FROM previos),
       hoy AS (
         SELECT EXTRACT(HOUR FROM created_at)::int AS hora, COUNT(*) AS n
           FROM escaneos
          WHERE caja_id IS NOT NULL AND created_at >= ${HOY_LOCAL}
          GROUP BY 1
       )
       SELECT h.hora,
              COALESCE(hoy.n, 0) AS hoy,
              ROUND(COALESCE((SELECT SUM(p.n) FROM previos p WHERE p.hora = h.hora), 0)
                    / GREATEST((SELECT d FROM dias), 1)) AS promedio
         FROM generate_series(0, 23) AS h(hora)
         LEFT JOIN hoy ON hoy.hora = h.hora
        ORDER BY h.hora`,
    ),
    // Cajas que se quedaron a medias: abiertas, con al menos un par y sin
    // actividad en los últimos 10 minutos (las que se están llenando no cuentan).
    pool.query(
      `SELECT ca.id, ca.codigo_caja, s.sku_number, ca.cantidad_pares,
              COUNT(e.id) AS escaneados,
              ${fechaHora("MAX(e.created_at)")} AS ultima_lectura
         FROM cajas ca
         JOIN skus s ON s.id = ca.sku_id
         JOIN escaneos e ON e.caja_id = ca.id
        WHERE ca.estado = 'abierta'
        GROUP BY ca.id, s.sku_number
       HAVING MAX(e.created_at) < ${AHORA_LOCAL} - interval '10 minutes'
        ORDER BY MAX(e.created_at) DESC`,
    ),
    // POs en curso: primero las listas para enviar, luego por avance.
    pool.query(
      `SELECT po.id, po.po_number, po.estado,
              COUNT(c.id) AS total_cartones,
              COUNT(c.id) FILTER (WHERE c.estado = 'completo') AS cartones_completos
         FROM purchase_orders po
         JOIN cartones c ON c.po_id = po.id
        WHERE po.estado IN ('en_proceso', 'completo')
        GROUP BY po.id
        ORDER BY (po.estado = 'completo') DESC,
                 COUNT(c.id) FILTER (WHERE c.estado = 'completo')::float / COUNT(c.id) DESC
        LIMIT 8`,
    ),
    pool.query(
      `SELECT ${fechaHora("e.created_at")} AS fecha_hora, q.codigo_qr,
              s.sku_number, ca.codigo_caja
         FROM escaneos e
         JOIN codigos_qr q ON q.id = e.codigo_qr_id
         LEFT JOIN skus s ON s.id = q.sku_id
         LEFT JOIN cajas ca ON ca.id = e.caja_id
        ORDER BY e.created_at DESC
        LIMIT 12`,
    ),
  ]);

  const inc = incompletas.rows;
  return {
    hoy: hoy.rows[0],
    por_hora: porHora.rows,
    incompletas: {
      total: inc.length,
      falta_uno: inc.filter((c) => c.cantidad_pares - c.escaneados === 1).length,
      cajas: inc.slice(0, 8),
    },
    pos: pos.rows,
    actividad: actividad.rows,
  };
}

// POs para los selectores de reportes, sin límite de cantidad.
//   filtro = "pendientes"   → solo POs con al menos un cartón sin completar
//   filtro = "con_escaneos" → solo POs con pares ya ligados a sus cartones
async function posParaReportes({ filtro = "", search = "" } = {}) {
  const conditions = [];
  const qp = [];
  if (search) {
    qp.push(`%${search}%`);
    conditions.push(`po.po_number ILIKE $${qp.length}`);
  }
  if (filtro === "con_escaneos") {
    conditions.push(`EXISTS (
      SELECT 1 FROM cartones c2
       WHERE c2.po_id = po.id
         AND (EXISTS (SELECT 1 FROM cajas ca WHERE ca.carton_id = c2.id)
              OR EXISTS (SELECT 1 FROM escaneos e WHERE e.carton_id = c2.id)))`);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const having =
    filtro === "pendientes"
      ? "HAVING COUNT(c.id) FILTER (WHERE c.estado <> 'completo') > 0"
      : "";

  const { rows } = await pool.query(
    `SELECT po.id, po.po_number, po.estado, po.cantidad_pares,
            COUNT(c.id) AS total_cartones,
            COUNT(c.id) FILTER (WHERE c.estado = 'completo') AS cartones_completos,
            COUNT(c.id) FILTER (WHERE c.estado <> 'completo') AS cartones_pendientes
       FROM purchase_orders po
       LEFT JOIN cartones c ON c.po_id = po.id
       ${where}
      GROUP BY po.id
      ${having}
      ORDER BY po.created_at DESC`,
    qp,
  );
  return rows;
}

// Una fila por par escaneado en Producción, en orden cronológico, con su caja
// y, si ya se embarcó, el cartón y la PO. El cartón sale de la caja (modo
// directo) o del escaneo de Embarque del mismo QR (musical, parcial o caja
// dividida).
async function detalleCajasQR(params = {}) {
  const {
    codigo = "",
    sku = "",
    po_number = "",
    estado = "",
    fecha_desde = "",
    fecha_hasta = "",
    page = 1,
    limit = 100,
    all = "0",
  } = params;

  const conditions = [];
  const qp = [];
  const add = (sql, value) => {
    qp.push(value);
    conditions.push(sql.replace("?", "$" + qp.length));
  };
  if (codigo) add("ca.codigo_caja ILIKE ?", `%${codigo.trim()}%`);
  if (sku) add("s.sku_number ILIKE ?", `%${sku.trim()}%`);
  if (po_number) add("po.po_number ILIKE ?", `%${po_number.trim()}%`);
  if (estado) add("ca.estado = ?", estado);
  if (fecha_desde) add("e.created_at >= ?::date", fecha_desde);
  if (fecha_hasta) add("e.created_at < ?::date + 1", fecha_hasta);
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const from = `
    FROM escaneos e
    JOIN cajas ca ON ca.id = e.caja_id
    JOIN skus s ON s.id = ca.sku_id
    JOIN codigos_qr q ON q.id = e.codigo_qr_id
    LEFT JOIN escaneos em ON em.codigo_qr_id = e.codigo_qr_id AND em.carton_id IS NOT NULL
    LEFT JOIN cartones c ON c.id = COALESCE(ca.carton_id, em.carton_id)
    LEFT JOIN purchase_orders po ON po.id = c.po_id
    ${where}`;

  const select = `
    SELECT ca.id AS caja_id, ca.codigo_caja, ca.estado AS caja_estado,
           ca.cantidad_pares, ${fechaHora("ca.created_at")} AS caja_abierta_at,
           s.sku_number, s.style_name, s.size, s.color_name,
           q.codigo_qr, substring(q.codigo_qr from '[^/]+$') AS token,
           q.upc, q.estado AS qr_estado,
           ${fechaHora("e.created_at")} AS escaneado_at,
           c.carton_id, po.po_number
    ${from}
    ORDER BY e.created_at, e.id`;

  if (String(all) === "1") {
    const { rows } = await pool.query(select, qp);
    return { data: rows, total: rows.length, page: 1, pages: 1 };
  }

  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT ca.id) AS cajas ${from}`,
    qp,
  );
  const total = parseInt(totalRows[0].total);
  const lim = parseInt(limit) || 100;
  const pagina = parseInt(page) || 1;
  qp.push(lim, (pagina - 1) * lim);
  const { rows } = await pool.query(
    `${select} LIMIT $${qp.length - 1} OFFSET $${qp.length}`,
    qp,
  );
  return {
    data: rows,
    total,
    cajas: parseInt(totalRows[0].cajas),
    page: pagina,
    pages: Math.max(1, Math.ceil(total / lim)),
  };
}

module.exports = {
  dashboard,
  posParaReportes,
  detalleCajasQR,
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
  qrsSinSKUPorUPC,
  historialEnviosT4,
  detalleCartonesPorPO,
};
