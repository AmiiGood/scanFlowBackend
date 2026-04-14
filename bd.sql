CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(30) NOT NULL CHECK (rol IN ('operador_produccion', 'operador_embarque', 'superadmin')),
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