const pool = require("../config/database");
const { hashPassword } = require("../services/authService");

async function getAll(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, nombre, email, rol, activo, created_at FROM users ORDER BY created_at DESC",
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOne(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT id, nombre, email, rol, activo, created_at FROM users WHERE id = $1",
      [req.params.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function create(req, res) {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: "Todos los campos son requeridos" });
    }

    const ROLES = ["operador_produccion", "operador_embarque", "superadmin"];
    if (!ROLES.includes(rol)) {
      return res.status(400).json({ error: "Rol inválido" });
    }

    const password_hash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, email, rol, activo, created_at`,
      [nombre, email, password_hash, rol],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Email ya registrado" });
    res.status(500).json({ error: err.message });
  }
}

async function update(req, res) {
  try {
    const { nombre, email, rol, activo } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET
        nombre = COALESCE($1, nombre),
        email = COALESCE($2, email),
        rol = COALESCE($3, rol),
        activo = COALESCE($4, activo),
        updated_at = NOW()
       WHERE id = $5
       RETURNING id, nombre, email, rol, activo, updated_at`,
      [nombre, email, rol, activo, req.params.id],
    );
    if (!rows[0])
      return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Email ya registrado" });
    res.status(500).json({ error: err.message });
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
    if (!rows[0])
      return res.status(404).json({ error: "Usuario no encontrado" });
    res.json({ message: "Password actualizado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAll, getOne, create, update, changePassword };
