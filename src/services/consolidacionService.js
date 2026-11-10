// Consolidación de cajas (almacén). A las cajas les van sacando pares para
// musicales o para completar órdenes; los que les sobran se juntan en una sola
// caja del mismo SKU, la de etiqueta mejor cuidada. La caja destino puede
// quedarse incompleta y retomarse cuando se quiera: el tope es su etiqueta,
// contando solo los pares que siguen en ella.
//
// Mover un par es cambiar de caja su escaneo de Producción (conserva fecha,
// turno y usuario) y dejar el movimiento en `consolidaciones`.
const pool = require("../config/database");
const { normalizeQR, normalizeCodigoCaja } = require("./scanValidationService");

// Pares que siguen en la caja: escaneados (o consolidados) en ella y que no
// están en ningún cartón. Una caja que entró completa a un cartón no tiene
// ninguno disponible. Primero los últimos que entraron (la cama de arriba).
const DISPONIBLES = `
  SELECT e.id AS escaneo_id, e.codigo_qr_id
    FROM escaneos e
    JOIN cajas ca ON ca.id = e.caja_id
    JOIN codigos_qr q ON q.id = e.codigo_qr_id
   WHERE e.caja_id = $1
     AND ca.carton_id IS NULL
     AND q.estado = 'escaneado'
     AND NOT EXISTS (SELECT 1 FROM escaneos e2
                      WHERE e2.codigo_qr_id = e.codigo_qr_id AND e2.carton_id IS NOT NULL)
   ORDER BY e.created_at DESC, e.id DESC`;

const pares = (n) => `${n} ${n === 1 ? "par" : "pares"}`;

async function resumenCaja(db, caja_id) {
  const { rows } = await db.query(
    `SELECT ca.id, ca.codigo_caja, ca.estado, ca.cantidad_pares, ca.sku_id,
            s.sku_number, s.style_name, s.size,
            (SELECT COUNT(*) FROM (${DISPONIBLES}) d)::int AS disponibles,
            (SELECT COUNT(*) FROM escaneos e WHERE e.caja_id = ca.id)::int AS escaneados
       FROM cajas ca
       JOIN skus s ON s.id = ca.sku_id
      WHERE ca.id = $1`,
    [caja_id],
  );
  return rows[0];
}

// Una caja que entró completa a un cartón ya está en una PO: no se toca.
function asegurarSinCarton(caja, cual) {
  if (caja.carton_id)
    throw {
      status: 409,
      message: `${cual} entró completa a un cartón: sus pares ya están en una PO`,
    };
}

async function bloquearCajas(client, ids) {
  const { rows } = await client.query(
    `SELECT ca.*, s.sku_number
       FROM cajas ca JOIN skus s ON s.id = ca.sku_id
      WHERE ca.id = ANY($1)
      ORDER BY ca.id
        FOR UPDATE OF ca`,
    [ids],
  );
  return rows;
}

async function libresEn(client, destino) {
  const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM (${DISPONIBLES}) d`, [destino.id]);
  return destino.cantidad_pares - rows[0].n;
}

async function mover(client, destino, origen_id, disponibles, user_id) {
  await client.query("UPDATE escaneos SET caja_id = $1 WHERE id = ANY($2)", [
    destino.id,
    disponibles.map((d) => d.escaneo_id),
  ]);
  await client.query(
    `INSERT INTO consolidaciones (codigo_qr_id, caja_origen_id, caja_destino_id, created_by)
     SELECT unnest($1::int[]), $2, $3, $4`,
    [disponibles.map((d) => d.codigo_qr_id), origen_id, destino.id, user_id],
  );
  // La caja destino queda cerrada aunque no se llene: así Embarque puede usar
  // sus pares. Se puede seguir consolidando en ella cuando se quiera.
  if (destino.estado !== "empacada")
    await client.query("UPDATE cajas SET estado = 'empacada' WHERE id = $1", [destino.id]);
}

// La caja que se va a llenar (la que se queda).
async function buscarDestino(codigo_caja) {
  const codigo = normalizeCodigoCaja(codigo_caja || "");
  if (!codigo) throw { status: 400, message: "Escanea la etiqueta de la caja" };
  const { rows } = await pool.query("SELECT id, carton_id FROM cajas WHERE codigo_caja = $1", [codigo]);
  if (!rows[0]) throw { status: 404, message: "Caja no encontrada" };
  asegurarSinCarton(rows[0], "Esta caja");
  return resumenCaja(pool, rows[0].id);
}

// Pasa a la caja destino todos los pares disponibles de otra caja. Si no caben
// todos, no mueve nada: se separan los que caben y se escanean QR por QR.
async function consolidarCaja(destino_id, codigo_caja, user_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: origenRows } = await client.query("SELECT id FROM cajas WHERE codigo_caja = $1", [
      normalizeCodigoCaja(codigo_caja),
    ]);
    if (!origenRows[0]) throw { status: 404, message: "Caja no encontrada" };
    const origen_id = origenRows[0].id;
    if (origen_id === Number(destino_id))
      throw { status: 409, message: "Es la misma caja que estás llenando" };

    const cajas = await bloquearCajas(client, [Number(destino_id), origen_id]);
    const destino = cajas.find((c) => c.id === Number(destino_id));
    const origen = cajas.find((c) => c.id === origen_id);
    if (!destino) throw { status: 404, message: "La caja que estás llenando ya no existe" };
    asegurarSinCarton(destino, "La caja que estás llenando");
    asegurarSinCarton(origen, "Esta caja");
    if (origen.sku_id !== destino.sku_id)
      throw {
        status: 409,
        message: `Esta caja es ${origen.sku_number} y la que estás llenando es ${destino.sku_number}`,
      };

    const { rows: disponibles } = await client.query(DISPONIBLES, [origen.id]);
    if (!disponibles.length)
      throw { status: 409, message: "Esta caja ya no tiene pares disponibles: todos están en cartones" };
    const libres = await libresEn(client, destino);
    if (libres <= 0)
      throw { status: 409, message: `La caja ya tiene sus ${pares(destino.cantidad_pares)}` };

    if (disponibles.length > libres) {
      await client.query("ROLLBACK");
      return {
        requiere_qr: true,
        caben: libres,
        disponibles: disponibles.length,
        origen: origen.codigo_caja,
        resumen: await resumenCaja(pool, destino.id),
      };
    }

    await mover(client, destino, origen.id, disponibles, user_id);
    const resumen = await resumenCaja(client, destino.id);
    await client.query("COMMIT");
    return { movidos: disponibles.length, origen: origen.codigo_caja, resumen };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Pasa un par suelto a la caja destino, venga de la caja que venga.
async function consolidarQR(destino_id, codigo_qr, user_id) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: qrRows } = await client.query(
      `SELECT q.*, s.sku_number
         FROM codigos_qr q LEFT JOIN skus s ON s.id = q.sku_id
        WHERE q.codigo_qr = $1
          FOR UPDATE OF q`,
      [normalizeQR(String(codigo_qr).trim())],
    );
    const qr = qrRows[0];
    if (!qr) throw { status: 404, message: "QR no encontrado" };
    if (qr.estado === "enviado") throw { status: 409, message: "Este par ya se envió a T4" };
    if (qr.estado !== "escaneado") throw { status: 409, message: "Este par no se escaneó en Producción" };

    const { rows: enPO } = await client.query(
      `SELECT po.po_number
         FROM escaneos e
         JOIN cartones c ON c.id = e.carton_id
         JOIN purchase_orders po ON po.id = c.po_id
        WHERE e.codigo_qr_id = $1
        LIMIT 1`,
      [qr.id],
    );
    if (enPO[0]) throw { status: 409, message: `Este par ya está en la PO ${enPO[0].po_number}` };

    const { rows: prod } = await client.query(
      `SELECT id AS escaneo_id, codigo_qr_id, caja_id
         FROM escaneos
        WHERE codigo_qr_id = $1 AND caja_id IS NOT NULL
        ORDER BY id
        LIMIT 1`,
      [qr.id],
    );
    if (!prod[0]) throw { status: 409, message: "Este par no está en ninguna caja de Producción" };
    if (prod[0].caja_id === Number(destino_id)) throw { status: 409, message: "Este par ya está en esta caja" };

    const cajas = await bloquearCajas(client, [Number(destino_id), prod[0].caja_id]);
    const destino = cajas.find((c) => c.id === Number(destino_id));
    const origen = cajas.find((c) => c.id === prod[0].caja_id);
    if (!destino) throw { status: 404, message: "La caja que estás llenando ya no existe" };
    asegurarSinCarton(destino, "La caja que estás llenando");
    asegurarSinCarton(origen, "La caja de este par");
    if (qr.sku_id !== destino.sku_id)
      throw {
        status: 409,
        message: `Este par es ${qr.sku_number || "de otro SKU"} y la caja es ${destino.sku_number}`,
      };
    if ((await libresEn(client, destino)) <= 0)
      throw { status: 409, message: `La caja ya tiene sus ${pares(destino.cantidad_pares)}` };

    await mover(client, destino, origen.id, prod, user_id);
    const resumen = await resumenCaja(client, destino.id);
    await client.query("COMMIT");
    return { movidos: 1, origen: origen.codigo_caja, resumen };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reportes › Consolidaciones: un renglón por par movido.
async function reporte(params = {}) {
  const { fecha_desde = "", fecha_hasta = "", codigo = "", page = 1, limit = 50, all = "0" } = params;
  const conditions = [];
  const qp = [];
  const add = (sql, value) => {
    qp.push(value);
    conditions.push(sql.replace(/\?/g, "$" + qp.length));
  };
  if (fecha_desde) add("k.created_at >= ?::date", fecha_desde);
  if (fecha_hasta) add("k.created_at < ?::date + 1", fecha_hasta);
  if (codigo.trim())
    add(
      "(co.codigo_caja ILIKE ? OR cd.codigo_caja ILIKE ? OR q.codigo_qr ILIKE ? OR s.sku_number ILIKE ?)",
      `%${codigo.trim().replace(/['{]/g, "-").replace(/[\\%_]/g, (c) => "\\" + c)}%`,
    );
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const from = `
      FROM consolidaciones k
      JOIN codigos_qr q ON q.id = k.codigo_qr_id
      JOIN cajas co ON co.id = k.caja_origen_id
      JOIN cajas cd ON cd.id = k.caja_destino_id
      LEFT JOIN skus s ON s.id = q.sku_id
      LEFT JOIN users u ON u.id = k.created_by
      ${where}`;
  const select = `
    SELECT k.id, to_char(k.created_at, 'YYYY-MM-DD HH24:MI:SS') AS fecha_hora,
           q.codigo_qr, substring(q.codigo_qr from '[^/]+$') AS token,
           s.sku_number, s.size,
           co.codigo_caja AS caja_origen, cd.codigo_caja AS caja_destino,
           u.nombre AS usuario
      ${from}
     ORDER BY k.created_at DESC, k.id DESC`;

  if (String(all) === "1") {
    const { rows } = await pool.query(select, qp);
    return { data: rows, total: rows.length, page: 1, pages: 1 };
  }
  const { rows: tot } = await pool.query(`SELECT COUNT(*)::int AS n ${from}`, qp);
  const lim = parseInt(limit) || 50;
  const pagina = parseInt(page) || 1;
  qp.push(lim, (pagina - 1) * lim);
  const { rows } = await pool.query(`${select} LIMIT $${qp.length - 1} OFFSET $${qp.length}`, qp);
  return { data: rows, total: tot[0].n, page: pagina, pages: Math.max(1, Math.ceil(tot[0].n / lim)) };
}

module.exports = { buscarDestino, consolidarCaja, consolidarQR, reporte, resumenCaja };
