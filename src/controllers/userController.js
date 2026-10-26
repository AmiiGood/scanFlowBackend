const pool = require("../config/database");
const { hashPassword } = require("../services/authService");
const permisosService = require("../services/permisosService");

const COLUMNAS = `u.id, u.nombre, u.email, u.rol, u.activo, u.created_at, u.perfil_id, p.nombre AS perfil`;
const DESDE = `FROM users u LEFT JOIN perfiles p ON p.id = u.perfil_id`;

async function getAll(req, res) {
  try {
    const { rows } = await pool.query(`SELECT ${COLUMNAS} ${DESDE} ORDER BY u.created_at DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOne(req, res) {
  try {
    const { rows } = await pool.query(`SELECT ${COLUMNAS} ${DESDE} WHERE u.id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// El rol del usuario sale de su perfil (rol_base): se conserva para lo que aún
// lo usa, como el superadmin y los listados de operadores.
async function perfilPorId(db, perfil_id) {
  const { rows } = await db.query("SELECT id, rol_base FROM perfiles WHERE id = $1", [perfil_id]);
  if (!rows[0]) throw { status: 400, message: "Perfil inválido" };
  return rows[0];
}

// Siempre debe quedar al menos un administrador activo.
async function asegurarOtroAdmin(db, user_id) {
  const { rows } = await db.query(
    "SELECT COUNT(*)::int AS n FROM users WHERE rol = 'superadmin' AND activo AND id <> $1",
    [user_id],
  );
  if (!rows[0].n)
    throw { status: 409, message: "Debe quedar al menos un usuario Administrador activo" };
}

async function create(req, res) {
  try {
    const { nombre, email, password, perfil_id } = req.body;
    if (!nombre || !email || !password || !perfil_id)
      return res.status(400).json({ error: "Todos los campos son requeridos" });
    const perfil = await perfilPorId(pool, perfil_id);

    const password_hash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (nombre, email, password_hash, rol, perfil_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [nombre, email, password_hash, perfil.rol_base, perfil.id],
    );
    res.status(201).json({ id: rows[0].id });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Email ya registrado" });
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function update(req, res) {
  const client = await pool.connect();
  try {
    const { nombre, email, perfil_id, activo } = req.body;
    await client.query("BEGIN");
    const { rows: actual } = await client.query("SELECT id, rol, activo FROM users WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!actual[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const perfil = perfil_id ? await perfilPorId(client, perfil_id) : null;
    const rol = perfil ? perfil.rol_base : actual[0].rol;
    const quedaActivo = activo ?? actual[0].activo;
    // Un administrador que deja de serlo, o se desactiva, no puede ser el último.
    if (actual[0].rol === "superadmin" && (rol !== "superadmin" || !quedaActivo))
      await asegurarOtroAdmin(client, actual[0].id);
    if (Number(req.params.id) === req.user.id && !quedaActivo)
      throw { status: 409, message: "No puedes desactivar tu propio usuario" };

    await client.query(
      `UPDATE users SET
         nombre = COALESCE($1, nombre),
         email = COALESCE($2, email),
         rol = $3,
         perfil_id = COALESCE($4, perfil_id),
         activo = $5,
         updated_at = NOW()
       WHERE id = $6`,
      [nombre, email, rol, perfil?.id ?? null, quedaActivo, req.params.id],
    );
    await client.query("COMMIT");
    permisosService.limpiarCache();
    res.json({ id: Number(req.params.id) });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Email ya registrado" });
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function changePassword(req, res) {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password requerido" });

    const password_hash = await hashPassword(password);
    const { rows } = await pool.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id",
      [password_hash, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ message: "Password actualizado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAll, getOne, create, update, changePassword };
