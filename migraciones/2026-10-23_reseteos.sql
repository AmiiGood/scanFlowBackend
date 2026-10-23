-- Registro de reseteos: quién lo hizo, qué se reseteó, por qué y, si no fue
-- un superadmin, qué supervisor lo autorizó con su gafete.
BEGIN;

CREATE TABLE IF NOT EXISTS reseteos (
  id SERIAL PRIMARY KEY,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('caja', 'carton', 'po', 'desasociar_caja')),
  objetivo_id INTEGER,
  codigo VARCHAR(255) NOT NULL,
  supervisor_id INTEGER REFERENCES supervisores(id),
  motivo VARCHAR(30) NOT NULL,
  comentario TEXT,
  resultado JSONB,
  hecho_por INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reseteos_created_at ON reseteos (created_at);

COMMIT;
