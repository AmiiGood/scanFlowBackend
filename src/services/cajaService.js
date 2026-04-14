const pool = require("../config/database");
const { parseCodgoCaja, validateQR } = require("./scanValidationService");

async function iniciarCaja(codigo_caja, user_id) {
  const codigoNormalizado = codigo_caja.replace(/['{]/g, "-");
  const { sku, cantidadPares, secuencial } = parseCodgoCaja(codigoNormalizado);

  const { rows: skuRows } = await pool.query(
    "SELECT * FROM skus WHERE sku_number = $1",
    [sku],
  );
  if (!skuRows[0]) throw { status: 404, message: `SKU no encontrado: ${sku}` };

  const { rows: existing } = await pool.query(
    "SELECT * FROM cajas WHERE codigo_caja = $1",
    [codigoNormalizado],
  );
  if (existing[0]) return existing[0];

  const { rows } = await pool.query(
    `INSERT INTO cajas (codigo_caja, sku_id, cantidad_pares, secuencial, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [codigoNormalizado, skuRows[0].id, cantidadPares, secuencial, user_id],
  );

  return rows[0];
}

async function escanearQR(caja_id, codigo_qr, user_id) {
  const { rows: cajaRows } = await pool.query(
    "SELECT * FROM cajas WHERE id = $1",
    [caja_id],
  );
  const caja = cajaRows[0];
  if (!caja) throw { status: 404, message: "Caja no encontrada" };
  if (caja.estado === "empacada")
    throw { status: 409, message: "La caja ya está empacada" };

  const qr = await validateQR(codigo_qr, caja.sku_id);

  const { rows: escaneos } = await pool.query(
    "SELECT COUNT(*) AS total FROM escaneos WHERE caja_id = $1",
    [caja_id],
  );
  const totalEscaneados = parseInt(escaneos[0].total);

  if (totalEscaneados >= caja.cantidad_pares) {
    throw {
      status: 409,
      message: `La caja ya tiene ${caja.cantidad_pares} pares escaneados`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      "INSERT INTO escaneos (caja_id, codigo_qr_id, created_by) VALUES ($1, $2, $3)",
      [caja_id, qr.id, user_id],
    );

    await client.query("UPDATE codigos_qr SET estado = $1 WHERE id = $2", [
      "escaneado",
      qr.id,
    ]);

    const nuevoTotal = totalEscaneados + 1;
    let nuevoCajaEstado = caja.estado;

    if (nuevoTotal >= caja.cantidad_pares) {
      await client.query("UPDATE cajas SET estado = $1 WHERE id = $2", [
        "empacada",
        caja_id,
      ]);
      nuevoCajaEstado = "empacada";
    }

    await client.query("COMMIT");

    return {
      escaneados: nuevoTotal,
      total: caja.cantidad_pares,
      caja_estado: nuevoCajaEstado,
      completa: nuevoCajaEstado === "empacada",
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function getProgresoCaja(caja_id) {
  const { rows: cajaRows } = await pool.query(
    `SELECT c.*, s.sku_number, s.style_name, s.size
     FROM cajas c
     JOIN skus s ON s.id = c.sku_id
     WHERE c.id = $1`,
    [caja_id],
  );
  if (!cajaRows[0]) throw { status: 404, message: "Caja no encontrada" };

  const { rows: escaneos } = await pool.query(
    `SELECT e.created_at, qr.codigo_qr
     FROM escaneos e
     JOIN codigos_qr qr ON qr.id = e.codigo_qr_id
     WHERE e.caja_id = $1
     ORDER BY e.created_at DESC`,
    [caja_id],
  );

  return {
    caja: cajaRows[0],
    escaneados: escaneos.length,
    total: cajaRows[0].cantidad_pares,
    escaneos,
  };
}

module.exports = { iniciarCaja, escanearQR, getProgresoCaja };
