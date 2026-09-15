-- Alinea una BD creada con el bd.sql viejo con lo que espera el código.
-- 1) Crea import_jobs (la usa la importación de códigos QR).
-- 2) Agrega 'operador_po' al CHECK de users.rol (lo usan rutas de PO, reportes y Trysor).
-- Idempotente: se puede correr más de una vez.

BEGIN;

CREATE TABLE IF NOT EXISTS import_jobs (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(50) NOT NULL,
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesando', 'completado', 'error')),
  parametros JSONB,
  resultado JSONB,
  error TEXT,
  created_by INTEGER REFERENCES users(id),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check;
ALTER TABLE users ADD CONSTRAINT users_rol_check
  CHECK (rol IN ('operador_produccion', 'operador_embarque', 'operador_po', 'superadmin'));

COMMIT;
