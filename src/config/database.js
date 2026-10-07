const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Sin este manejador, un corte de red con la BD en una conexión inactiva
// lanza un 'error' no atendido y detiene el servidor.
pool.on("error", (err) => {
  console.error("[pg] Error en conexión inactiva:", err.message);
});

module.exports = pool;