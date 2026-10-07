const crypto = require("crypto");
const pool = require("../config/database");

// El código del gafete: prefijo fijo + 20 caracteres al azar, solo mayúsculas
// y dígitos para que el escáner lo teclee igual con cualquier distribución de
// teclado (sin ":", "/" ni "-", que el teclado en español cambia). Sin 0/O ni 1/I.
const PREFIJO = "SFSUP";
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 32 símbolos → 100 bits

const MOTIVOS = {
  falta_par: "Falta un par",
  qr_danado: "QR dañado o ilegible",
  qr_no_encontrado: "QR no encontrado en el sistema",
  sku_distinto: "Par de otro SKU",
  etiqueta_caja: "Error en la etiqueta de la caja",
  otro: "Otro",
};

function generarCodigo() {
  // 256 es múltiplo de 32: el módulo no sesga ningún símbolo.
  const bytes = crypto.randomBytes(20);
  let codigo = PREFIJO;
  for (const b of bytes) codigo += ALFABETO[b % ALFABETO.length];
  return codigo;
}

// Con Bloq Mayús activo el escáner entrega minúsculas; cualquier otro
// carácter (Enter, espacios) se descarta.
const normalizar = (codigo) =>
  String(codigo || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const hashCodigo = (codigo) =>
  crypto.createHash("sha256").update(normalizar(codigo)).digest("hex");

async function listar() {
  const { rows } = await pool.query(
    `SELECT s.id, s.nombre, s.activo,
            to_char(s.codigo_generado_at, 'YYYY-MM-DD HH24:MI:SS') AS codigo_generado_at,
            COUNT(l.id) AS liberaciones,
            to_char(MAX(l.created_at), 'YYYY-MM-DD HH24:MI:SS') AS ultima_liberacion
       FROM supervisores s
       LEFT JOIN liberaciones_caja l ON l.supervisor_id = s.id
      GROUP BY s.id
      ORDER BY s.activo DESC, s.nombre`,
  );
  return rows;
}

// Devuelve el código en claro una sola vez, para imprimir el gafete.
async function crear(nombre, user_id) {
  nombre = String(nombre || "").trim();
  if (!nombre) throw { status: 400, message: "El nombre es requerido" };
  const codigo = generarCodigo();
  const { rows } = await pool.query(
    `INSERT INTO supervisores (nombre, codigo_hash, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, nombre, activo`,
    [nombre, hashCodigo(codigo), user_id],
  );
  return { supervisor: rows[0], codigo };
}

// Un gafete nuevo invalida el anterior (por ejemplo, si se perdió).
async function regenerar(id) {
  const codigo = generarCodigo();
  const { rows } = await pool.query(
    `UPDATE supervisores
        SET codigo_hash = $1, codigo_generado_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, nombre, activo`,
    [hashCodigo(codigo), id],
  );
  if (!rows[0]) throw { status: 404, message: "Supervisor no encontrado" };
  return { supervisor: rows[0], codigo };
}

async function actualizar(id, { nombre, activo }) {
  const { rows } = await pool.query(
    `UPDATE supervisores
        SET nombre = COALESCE(NULLIF(TRIM($1), ''), nombre),
            activo = COALESCE($2, activo)
      WHERE id = $3
      RETURNING id, nombre, activo`,
    [nombre ?? null, typeof activo === "boolean" ? activo : null, id],
  );
  if (!rows[0]) throw { status: 404, message: "Supervisor no encontrado" };
  return rows[0];
}

async function verificar(codigo, db = pool) {
  const { rows } = await db.query(
    "SELECT id, nombre FROM supervisores WHERE codigo_hash = $1 AND activo",
    [hashCodigo(codigo)],
  );
  if (!rows[0])
    throw { status: 404, message: "Gafete no válido o desactivado" };
  return rows[0];
}

// Libera la pantalla de Producción de una caja que no se puede completar. La
// caja se queda abierta con los pares que lleva (se puede retomar o resetear
// después); lo que cambia es que queda registrado quién autorizó y por qué.
async function liberarCaja(caja_id, { codigo, motivo, comentario }, user_id) {
  if (!MOTIVOS[motivo]) throw { status: 400, message: "Motivo no válido" };
  comentario = String(comentario || "").trim().slice(0, 500);
  if (motivo === "otro" && !comentario)
    throw { status: 400, message: "Describe el motivo de la liberación" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: cajaRows } = await client.query(
      "SELECT id, codigo_caja, estado, cantidad_pares FROM cajas WHERE id = $1 FOR UPDATE",
      [caja_id],
    );
    const caja = cajaRows[0];
    if (!caja) throw { status: 404, message: "Caja no encontrada" };
    if (caja.estado !== "abierta")
      throw { status: 409, message: "La caja ya está completa, no hace falta liberarla" };

    const supervisor = await verificar(codigo, client);

    const { rows: conteo } = await client.query(
      "SELECT COUNT(*)::int AS n FROM escaneos WHERE caja_id = $1",
      [caja_id],
    );
    const { rows } = await client.query(
      `INSERT INTO liberaciones_caja
         (caja_id, codigo_caja, supervisor_id, motivo, comentario,
          pares_escaneados, cantidad_pares, liberado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [caja.id, caja.codigo_caja, supervisor.id, motivo, comentario || null,
       conteo[0].n, caja.cantidad_pares, user_id],
    );
    await client.query("COMMIT");
    return { liberacion_id: rows[0].id, supervisor: supervisor.nombre };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function reporteLiberaciones(params = {}) {
  const { fecha_desde = "", fecha_hasta = "", page = 1, limit = 50, all = "0" } = params;
  const conditions = [];
  const qp = [];
  if (fecha_desde) {
    qp.push(fecha_desde);
    conditions.push(`l.created_at >= $${qp.length}::date`);
  }
  if (fecha_hasta) {
    qp.push(fecha_hasta);
    conditions.push(`l.created_at < $${qp.length}::date + 1`);
  }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const select = `
    SELECT l.id, to_char(l.created_at, 'YYYY-MM-DD HH24:MI:SS') AS fecha_hora,
           l.codigo_caja, sk.sku_number, l.pares_escaneados, l.cantidad_pares,
           l.motivo, l.comentario, s.nombre AS supervisor, u.nombre AS liberado_por,
           ca.estado AS caja_estado
      FROM liberaciones_caja l
      JOIN supervisores s ON s.id = l.supervisor_id
      LEFT JOIN users u ON u.id = l.liberado_por
      LEFT JOIN cajas ca ON ca.id = l.caja_id
      LEFT JOIN skus sk ON sk.id = ca.sku_id
      ${where}
     ORDER BY l.created_at DESC`;
  const conTexto = (rows) =>
    rows.map((r) => ({ ...r, motivo_texto: MOTIVOS[r.motivo] || r.motivo }));

  if (String(all) === "1") {
    const { rows } = await pool.query(select, qp);
    return { data: conTexto(rows), total: rows.length, page: 1, pages: 1 };
  }
  const { rows: tot } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM liberaciones_caja l ${where}`,
    qp,
  );
  const lim = parseInt(limit) || 50;
  const pagina = parseInt(page) || 1;
  qp.push(lim, (pagina - 1) * lim);
  const { rows } = await pool.query(
    `${select} LIMIT $${qp.length - 1} OFFSET $${qp.length}`,
    qp,
  );
  return {
    data: conTexto(rows),
    total: tot[0].n,
    page: pagina,
    pages: Math.max(1, Math.ceil(tot[0].n / lim)),
  };
}

module.exports = {
  MOTIVOS,
  listar,
  crear,
  regenerar,
  actualizar,
  verificar,
  liberarCaja,
  reporteLiberaciones,
  normalizar,
};
