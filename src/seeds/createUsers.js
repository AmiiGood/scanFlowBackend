require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const pool = require("../config/database");
const { hashPassword } = require("../services/authService");

const users = [
  {
    nombre: "Super Admin",
    email: "admin@foamcreations.mx",
    password: "Admin1234!",
    rol: "superadmin",
  },
  {
    nombre: "Operador Producción",
    email: "produccion@foamcreations.mx",
    password: "Prod1234!",
    rol: "operador_produccion",
  },
  {
    nombre: "Operador Embarque",
    email: "embarque@foamcreations.mx",
    password: "Emb1234!",
    rol: "operador_embarque",
  },
];

async function main() {
  console.log("Creando usuarios seed...\n");
  for (const u of users) {
    try {
      const password_hash = await hashPassword(u.password);
      const { rows } = await pool.query(
        `INSERT INTO users (nombre, email, password_hash, rol)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           activo = true
         RETURNING id, nombre, email, rol`,
        [u.nombre, u.email, password_hash, u.rol],
      );
      console.log(
        `✅ ${rows[0].rol.padEnd(22)} ${rows[0].email}  /  password: ${u.password}`,
      );
    } catch (err) {
      console.error(`❌ ${u.email}: ${err.message}`);
    }
  }
  await pool.end();
}

main();
