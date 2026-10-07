-- Liberación de cajas en Producción por un supervisor o líder.
-- Cada supervisor tiene un gafete con un QR; la base guarda solo el hash del
-- código (SHA-256), así que un gafete perdido se regenera y el viejo deja de servir.
-- Cada liberación queda registrada con el supervisor, el motivo y el avance de la caja.
-- Idempotente: se puede correr más de una vez.

BEGIN;

CREATE TABLE IF NOT EXISTS supervisores (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  codigo_hash CHAR(64) UNIQUE NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  codigo_generado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS liberaciones_caja (
  id SERIAL PRIMARY KEY,
  caja_id INTEGER REFERENCES cajas(id) ON DELETE SET NULL,
  codigo_caja VARCHAR(255) NOT NULL,
  supervisor_id INTEGER NOT NULL REFERENCES supervisores(id),
  motivo VARCHAR(30) NOT NULL,
  comentario TEXT,
  pares_escaneados INTEGER NOT NULL,
  cantidad_pares INTEGER NOT NULL,
  liberado_por INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_liberaciones_caja_created_at ON liberaciones_caja (created_at);

COMMIT;
