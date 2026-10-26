const pool = require("../config/database");
const permisosService = require("./permisosService");

const VALIDOS = new Set(permisosService.TODOS);

async function listar() {
  const { rows } = await pool.query(
    `SELECT p.id, p.clave, p.nombre, p.descripcion, p.rol_base,
            COALESCE(array_agg(pp.permiso ORDER BY pp.permiso) FILTER (WHERE pp.permiso IS NOT NULL), '{}') AS permisos,
            (SELECT COUNT(*)::int FROM users u WHERE u.perfil_id = p.id) AS usuarios
       FROM perfiles p
       LEFT JOIN perfil_permisos pp ON pp.perfil_id = p.id
      GROUP BY p.id
      ORDER BY p.clave IS NULL, p.id`,
  );
  // El Administrador tiene todo, aunque no lo guarde.
  return rows.map((p) => ({
    ...p,
    sistema: p.clave === "superadmin",
    permisos: p.clave === "superadmin" ? permisosService.TODOS : p.permisos,
  }));
}

function limpiar({ nombre, descripcion, permisos }) {
  nombre = String(nombre || "").trim().slice(0, 80);
  if (!nombre) throw { status: 400, message: "El perfil necesita un nombre" };
  if (!Array.isArray(permisos)) throw { status: 400, message: "Permisos inválidos" };
  const invalidos = permisos.filter((p) => !VALIDOS.has(p));
  if (invalidos.length) throw { status: 400, message: `Permisos desconocidos: ${invalidos.join(", ")}` };
  return {
    nombre,
    descripcion: String(descripcion || "").trim().slice(0, 300) || null,
    permisos: [...new Set(permisos)],
  };
}

async function guardarPermisos(client, perfil_id, permisos) {
  await client.query("DELETE FROM perfil_permisos WHERE perfil_id = $1", [perfil_id]);
  if (permisos.length)
    await client.query(
      "INSERT INTO perfil_permisos (perfil_id, permiso) SELECT $1, unnest($2::text[])",
      [perfil_id, permisos],
    );
}

async function crear(datos) {
  const { nombre, descripcion, permisos } = limpiar(datos);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO perfiles (nombre, descripcion, rol_base) VALUES ($1, $2, $3) RETURNING id`,
      [nombre, descripcion, permisosService.rolBase(permisos)],
    );
    await guardarPermisos(client, rows[0].id, permisos);
    await client.query("COMMIT");
    return { id: rows[0].id };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") throw { status: 409, message: `Ya existe un perfil llamado «${nombre}»` };
    throw err;
  } finally {
    client.release();
  }
}

async function actualizar(id, datos, user) {
  const { nombre, descripcion, permisos } = limpiar(datos);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT * FROM perfiles WHERE id = $1 FOR UPDATE", [id]);
    const perfil = rows[0];
    if (!perfil) throw { status: 404, message: "Perfil no encontrado" };
    if (perfil.clave === "superadmin")
      throw { status: 409, message: "El perfil Administrador no se puede editar: siempre tiene todos los permisos" };

    // Quien administra usuarios no puede quitarse a sí mismo ese permiso.
    const { rows: propio } = await client.query("SELECT perfil_id, rol FROM users WHERE id = $1", [user.id]);
    if (propio[0]?.perfil_id === perfil.id && propio[0].rol !== "superadmin" && !permisos.includes("usuarios.administrar"))
      throw { status: 409, message: "No puedes quitarle a tu propio perfil el permiso de administrar usuarios" };

    const rol = permisosService.rolBase(permisos);
    await client.query(
      `UPDATE perfiles SET nombre = $1, descripcion = $2, rol_base = $3, updated_at = NOW() WHERE id = $4`,
      [nombre, descripcion, rol, id],
    );
    await guardarPermisos(client, id, permisos);
    await client.query("UPDATE users SET rol = $1 WHERE perfil_id = $2 AND rol <> 'superadmin'", [rol, id]);
    await client.query("COMMIT");
    permisosService.limpiarCache();
    return { id: Number(id) };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") throw { status: 409, message: `Ya existe un perfil llamado «${nombre}»` };
    throw err;
  } finally {
    client.release();
  }
}

async function eliminar(id) {
  const { rows } = await pool.query(
    `SELECT p.clave, (SELECT COUNT(*)::int FROM users u WHERE u.perfil_id = p.id) AS usuarios
       FROM perfiles p WHERE p.id = $1`,
    [id],
  );
  if (!rows[0]) throw { status: 404, message: "Perfil no encontrado" };
  if (rows[0].clave) throw { status: 409, message: "Los perfiles base no se eliminan; puedes editar sus permisos" };
  if (rows[0].usuarios)
    throw { status: 409, message: `El perfil tiene ${rows[0].usuarios} usuario(s): cámbialos de perfil antes de eliminarlo` };
  await pool.query("DELETE FROM perfiles WHERE id = $1", [id]);
  return { id: Number(id) };
}

module.exports = { listar, crear, actualizar, eliminar };
