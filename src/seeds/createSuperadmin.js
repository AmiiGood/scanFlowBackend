require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const pool = require("../config/database");
const { hashPassword } = require("../services/authService");

async function main() {
  const nombre = process.env.SEED_NOMBRE || "Super Admin";
  const email = process.env.SEED_EMAIL || "admin@sweetcode.mx";
  const password = process.env.SEED_PASSWORD || "Admin1234!";

  try {
    const password_hash = await hashPassword(password);

    const { rows } = await pool.query(
      `INSERT INTO users (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'superadmin')
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         activo = true
       RETURNING id, nombre, email, rol`,
      [nombre, email, password_hash],
    );

    console.log("✅ Superadmin listo:");
    console.table(rows);
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await pool.end();
  }
}

main();
