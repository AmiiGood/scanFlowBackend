-- Perfiles con permisos. Los cinco roles de antes se vuelven cinco perfiles
-- con exactamente los mismos accesos, y cada usuario queda en el suyo: nadie
-- ve ni hace nada distinto hasta que se edite un perfil.
BEGIN;

CREATE TABLE IF NOT EXISTS perfiles (
  id SERIAL PRIMARY KEY,
  clave VARCHAR(30) UNIQUE,             -- perfiles base (uno por rol); NULL en los nuevos
  nombre VARCHAR(80) UNIQUE NOT NULL,
  descripcion TEXT,
  rol_base VARCHAR(30) NOT NULL DEFAULT 'reportes',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS perfil_permisos (
  perfil_id INTEGER NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  permiso VARCHAR(50) NOT NULL,
  PRIMARY KEY (perfil_id, permiso)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS perfil_id INTEGER REFERENCES perfiles(id);

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

COMMIT;
