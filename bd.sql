CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(30) NOT NULL CHECK (rol IN ('operador_produccion', 'operador_embarque', 'operador_po', 'reportes', 'superadmin')),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE skus (
  id SERIAL PRIMARY KEY,
  sku_number VARCHAR(100) UNIQUE NOT NULL,
  upc VARCHAR(50) UNIQUE NOT NULL,
  style_no VARCHAR(50),
  style_name VARCHAR(150),
  color VARCHAR(50),
  color_name VARCHAR(100),
  size VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE codigos_qr (
  id SERIAL PRIMARY KEY,
  codigo_qr VARCHAR(255) UNIQUE NOT NULL,
  upc VARCHAR(50) NOT NULL,
  sku_id INTEGER REFERENCES skus(id),
  estado VARCHAR(20) DEFAULT 'disponible' CHECK (estado IN ('disponible', 'escaneado', 'enviado')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number VARCHAR(100) UNIQUE NOT NULL,
  cantidad_pares INTEGER NOT NULL,
  cantidad_cartones INTEGER NOT NULL,
  cfm_xf_date DATE,
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'completo', 'enviado', 'cancelado')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cartones (
  id SERIAL PRIMARY KEY,
  carton_id VARCHAR(100) UNIQUE NOT NULL,
  po_id INTEGER REFERENCES purchase_orders(id),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('mono_sku', 'musical')),
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_proceso', 'completo')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE carton_detalles (
  id SERIAL PRIMARY KEY,
  carton_id INTEGER REFERENCES cartones(id) ON DELETE CASCADE,
  sku_id INTEGER REFERENCES skus(id),
  cantidad_por_carton INTEGER NOT NULL
);

CREATE TABLE cajas (
  id SERIAL PRIMARY KEY,
  codigo_caja VARCHAR(255) UNIQUE NOT NULL,
  sku_id INTEGER REFERENCES skus(id),
  cantidad_pares INTEGER NOT NULL,
  secuencial INTEGER,
  carton_id INTEGER REFERENCES cartones(id),
  estado VARCHAR(20) DEFAULT 'abierta' CHECK (estado IN ('abierta', 'empacada')),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE escaneos (
  id SERIAL PRIMARY KEY,
  caja_id INTEGER REFERENCES cajas(id),
  carton_id INTEGER REFERENCES cartones(id),
  codigo_qr_id INTEGER REFERENCES codigos_qr(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE envios_trysor (
  id SERIAL PRIMARY KEY,
  po_id INTEGER REFERENCES purchase_orders(id),
  estado VARCHAR(20) DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'cancelado', 'error')),
  respuesta_api JSONB,
  enviado_at TIMESTAMP,
  cancelado_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE configuraciones (
  clave VARCHAR(100) PRIMARY KEY,
  valor TEXT NOT NULL,
  descripcion TEXT,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE import_jobs (
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
CREATE INDEX idx_escaneos_caja_id ON escaneos (caja_id);
CREATE INDEX idx_escaneos_carton_id ON escaneos (carton_id);
CREATE INDEX idx_escaneos_codigo_qr_id ON escaneos (codigo_qr_id);
CREATE INDEX idx_escaneos_created_at ON escaneos (created_at);
CREATE INDEX idx_escaneos_created_by ON escaneos (created_by);
CREATE INDEX idx_carton_detalles_carton_id ON carton_detalles (carton_id);
CREATE INDEX idx_cartones_po_id ON cartones (po_id);
CREATE INDEX idx_cajas_carton_id ON cajas (carton_id);

CREATE TABLE supervisores (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  codigo_hash CHAR(64) UNIQUE NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  codigo_generado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE liberaciones_caja (
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

CREATE INDEX idx_liberaciones_caja_created_at ON liberaciones_caja (created_at);

CREATE TABLE reseteos (
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
CREATE INDEX idx_reseteos_created_at ON reseteos (created_at);

-- Perfiles con permisos (migraciones/2026-10-26_perfiles_permisos.sql)
CREATE TABLE perfiles (
  id SERIAL PRIMARY KEY,
  clave VARCHAR(30) UNIQUE,             -- perfiles base (uno por rol); NULL en los nuevos
  nombre VARCHAR(80) UNIQUE NOT NULL,
  descripcion TEXT,
  rol_base VARCHAR(30) NOT NULL DEFAULT 'reportes',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE perfil_permisos (
  perfil_id INTEGER NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  permiso VARCHAR(50) NOT NULL,
  PRIMARY KEY (perfil_id, permiso)
);

ALTER TABLE users ADD COLUMN perfil_id INTEGER REFERENCES perfiles(id);

INSERT INTO perfiles (clave, nombre, descripcion, rol_base) VALUES
  ('superadmin', 'Administrador', 'Acceso total. No se puede editar.', 'superadmin'),
  ('operador_produccion', 'Producción', 'Estaciones de Producción', 'operador_produccion'),
  ('operador_embarque', 'Embarque', 'Estaciones de Embarque', 'operador_embarque'),
  ('operador_po', 'Operador PO', 'Importación y envío de POs a T4, y reportes', 'operador_po'),
  ('reportes', 'Consulta de reportes', 'Dashboard, reportes y reseteos con gafete de supervisor', 'reportes')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO perfil_permisos (perfil_id, permiso)
SELECT p.id, x.permiso
  FROM perfiles p
  JOIN (VALUES
    ('operador_produccion', 'produccion.escanear'),
    ('operador_embarque', 'embarque.escanear'),
    ('operador_embarque', 'embarque.musical_po'),
    ('operador_po', 'pos.ver'),
    ('operador_po', 'pos.importar'),
    ('operador_po', 'pos.enviar_t4'),
    ('operador_po', 'reportes.ver'),
    ('operador_po', 'reportes.exportar'),
    ('reportes', 'dashboard.ver'),
    ('reportes', 'reportes.ver'),
    ('reportes', 'reportes.exportar'),
    ('reportes', 'reset.caja'),
    ('reportes', 'reset.desasociar'),
    ('reportes', 'reset.carton'),
    ('reportes', 'reset.po')
  ) AS x (clave, permiso) ON x.clave = p.clave
ON CONFLICT DO NOTHING;

UPDATE users u SET perfil_id = p.id
  FROM perfiles p
 WHERE u.perfil_id IS NULL AND p.clave = u.rol;
