const pool = require("../config/database");

// Llaves de configuración permitidas (whitelist) y su valor por defecto.
const CONFIG_DEFAULTS = {
  bloqueo_caja_produccion: "false",
};

async function getAll() {
  const { rows } = await pool.query(
    "SELECT clave, valor FROM configuraciones",
  );
  const config = { ...CONFIG_DEFAULTS };
  for (const r of rows) config[r.clave] = r.valor;
  return config;
}

async function get(clave) {
  const { rows } = await pool.query(
    "SELECT valor FROM configuraciones WHERE clave = $1",
    [clave],
  );
  return rows[0]?.valor ?? CONFIG_DEFAULTS[clave] ?? null;
}

async function set(clave, valor, userId) {
  if (!(clave in CONFIG_DEFAULTS)) {
    throw { status: 400, message: `Clave de configuración no válida: ${clave}` };
  }
  const { rows } = await pool.query(
    `INSERT INTO configuraciones (clave, valor, updated_by, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (clave)
     DO UPDATE SET valor = EXCLUDED.valor,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = NOW()
     RETURNING clave, valor`,
    [clave, String(valor), userId],
  );
  return rows[0];
}

module.exports = { getAll, get, set };
