-- Agrega el rol 'reportes' (solo consulta: Reportes y Dashboard) al CHECK de users.rol.
-- Idempotente: se puede correr más de una vez.

BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_rol_check;
ALTER TABLE users ADD CONSTRAINT users_rol_check
  CHECK (rol IN ('operador_produccion', 'operador_embarque', 'operador_po', 'reportes', 'superadmin'));

COMMIT;
