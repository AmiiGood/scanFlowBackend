-- Consolidación de cajas (almacén): los pares que les sobran a varias cajas del
-- mismo SKU se juntan en una. Cada par movido queda registrado aquí; su escaneo
-- de Producción conserva fecha, turno y usuario, y solo cambia de caja.
BEGIN;

CREATE TABLE IF NOT EXISTS consolidaciones (
  id SERIAL PRIMARY KEY,
  codigo_qr_id INTEGER NOT NULL REFERENCES codigos_qr(id),
  caja_origen_id INTEGER NOT NULL REFERENCES cajas(id),
  caja_destino_id INTEGER NOT NULL REFERENCES cajas(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_consolidaciones_origen ON consolidaciones (caja_origen_id);
CREATE INDEX IF NOT EXISTS idx_consolidaciones_destino ON consolidaciones (caja_destino_id);
CREATE INDEX IF NOT EXISTS idx_consolidaciones_qr ON consolidaciones (codigo_qr_id);
CREATE INDEX IF NOT EXISTS idx_consolidaciones_created_at ON consolidaciones (created_at);

-- Perfil para la gente de almacén. No es base: se puede editar o borrar.
INSERT INTO perfiles (nombre, descripcion, rol_base)
VALUES ('Almacén', 'Consolidar cajas del mismo SKU', 'reportes')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO perfil_permisos (perfil_id, permiso)
SELECT id, 'almacen.consolidar' FROM perfiles WHERE nombre = 'Almacén'
ON CONFLICT DO NOTHING;

COMMIT;
