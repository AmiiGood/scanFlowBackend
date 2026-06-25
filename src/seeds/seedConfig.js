require("dotenv").config();
const pool = require("../config/database");

// Crea la tabla de configuraciones (si no existe) y siembra las llaves por
// defecto. Idempotente: se puede correr múltiples veces sin efectos adversos.
async function seedConfig() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configuraciones (
      clave VARCHAR(100) PRIMARY KEY,
      valor TEXT NOT NULL,
      descripcion TEXT,
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(
    `INSERT INTO configuraciones (clave, valor, descripcion)
     VALUES ($1, $2, $3)
     ON CONFLICT (clave) DO NOTHING`,
    [
      "bloqueo_caja_produccion",
      "false",
      "Bloquea por completo la pantalla de producción hasta terminar de escanear la caja activa",
    ],
  );

  console.log("✓ Configuración inicializada (bloqueo_caja_produccion = false)");
}

seedConfig()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error al inicializar configuración:", err);
    process.exit(1);
  });
