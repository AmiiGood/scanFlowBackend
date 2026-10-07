-- Índices que faltaban en las tablas que se consultan en cada escaneo.
-- Sin ellos, cada lectura de Producción recorría toda `escaneos` y el resumen de
-- una PO en Embarque tardaba ~22 s (PO de 859 cartones, 77 mil escaneos).
--
-- CONCURRENTLY no bloquea las escrituras: se puede correr con la planta operando.
-- No se puede ejecutar dentro de una transacción: correr cada sentencia por separado
-- (psql lo hace así por defecto; en pgAdmin, sin BEGIN). Es idempotente.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escaneos_caja_id ON escaneos (caja_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escaneos_carton_id ON escaneos (carton_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escaneos_codigo_qr_id ON escaneos (codigo_qr_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escaneos_created_at ON escaneos (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_escaneos_created_by ON escaneos (created_by);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_carton_detalles_carton_id ON carton_detalles (carton_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cartones_po_id ON cartones (po_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cajas_carton_id ON cajas (carton_id);
