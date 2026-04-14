const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/database");

const SALT_ROUNDS = 12;

async function login(email, password) {
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email = $1 AND activo = true",
    [email],
  );
  const user = rows[0];
  if (!user) throw { status: 401, message: "Credenciales inválidas" };

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw { status: 401, message: "Credenciales inválidas" };

  const accessToken = jwt.sign(
    { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );

  const refreshToken = crypto.randomBytes(64).toString("hex");
  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await pool.query(
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [user.id, tokenHash, expiresAt],
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
    },
  };
}

async function refresh(refreshToken) {
  if (!refreshToken) throw { status: 401, message: "Refresh token requerido" };

  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  const { rows } = await pool.query(
    "SELECT rt.*, u.* FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id WHERE rt.token_hash = $1 AND rt.expires_at > NOW() AND u.activo = true",
    [tokenHash],
  );

  const record = rows[0];
  if (!record)
    throw { status: 401, message: "Refresh token inválido o expirado" };

  const accessToken = jwt.sign(
    {
      id: record.user_id,
      email: record.email,
      rol: record.rol,
      nombre: record.nombre,
    },
    process.env.JWT_SECRET,
    { expiresIn: "15m" },
  );

  return { accessToken };
}

async function logout(refreshToken) {
  if (!refreshToken) return;
  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");
  await pool.query("DELETE FROM refresh_tokens WHERE token_hash = $1", [
    tokenHash,
  ]);
}

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

module.exports = { login, refresh, logout, hashPassword };
