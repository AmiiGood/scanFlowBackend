const pool = require("../config/database");

// Catálogo de permisos. Un perfil es un conjunto de estos permisos y cada
// usuario tiene un perfil. El superadmin (perfil Administrador) tiene todos.
const CATALOGO = [
  {
    grupo: "Estaciones",
    permisos: [
      { clave: "produccion.escanear", nombre: "Escanear en Producción", ayuda: "Abrir cajas, escanear pares y liberar cajas con gafete" },
      { clave: "embarque.escanear", nombre: "Embarque por cartón", ayuda: "Escanear cartones con cajas o QR por QR" },
      { clave: "embarque.musical_po", nombre: "Embarque musical por PO", ayuda: "Escribir la PO y escanear las cajas" },
    ],
  },
  {
    grupo: "Reportes",
    permisos: [
      { clave: "dashboard.ver", nombre: "Ver el Dashboard" },
      { clave: "reportes.ver", nombre: "Ver Reportes" },
      { clave: "reportes.exportar", nombre: "Exportar reportes a Excel" },
    ],
  },
  {
    grupo: "Purchase Orders",
    permisos: [
      { clave: "pos.ver", nombre: "Ver Purchase Orders" },
      { clave: "pos.importar", nombre: "Importar POs" },
      { clave: "pos.enviar_t4", nombre: "Enviar POs a T4" },
      { clave: "pos.cancelar_t4", nombre: "Cancelar envíos a T4" },
    ],
  },
  {
    grupo: "Catálogo y QRs",
    permisos: [
      { clave: "skus.administrar", nombre: "Ver e importar SKUs" },
      { clave: "qrs.importar", nombre: "Importar QRs de Trysor" },
    ],
  },
  {
    grupo: "Reset",
    permisos: [
      { clave: "reset.caja", nombre: "Resetear cajas" },
      { clave: "reset.desasociar", nombre: "Desasociar cajas de sus cartones" },
      { clave: "reset.carton", nombre: "Resetear cartones" },
      { clave: "reset.po", nombre: "Resetear POs" },
      { clave: "reset.sin_gafete", nombre: "Resetear sin gafete", ayuda: "Sin este permiso, cada reset pide el gafete de un supervisor" },
    ],
  },
  {
    grupo: "Administración",
    permisos: [
      { clave: "usuarios.administrar", nombre: "Usuarios y perfiles" },
      { clave: "supervisores.administrar", nombre: "Supervisores y gafetes" },
      { clave: "config.editar", nombre: "Configuración (bloqueo de Producción)" },
      { clave: "backup.generar", nombre: "Generar respaldos" },
    ],
  },
];

const TODOS = CATALOGO.flatMap((g) => g.permisos.map((p) => p.clave));
const RESET = TODOS.filter((p) => p.startsWith("reset.") && p !== "reset.sin_gafete");

// Los mismos accesos que tenían los roles antes de los perfiles. Se usan si la
// migración de perfiles aún no se corrió, para que nadie pierda acceso.
const POR_ROL = {
  operador_produccion: ["produccion.escanear"],
  operador_embarque: ["embarque.escanear", "embarque.musical_po"],
  operador_po: ["pos.ver", "pos.importar", "pos.enviar_t4", "reportes.ver", "reportes.exportar"],
  reportes: ["dashboard.ver", "reportes.ver", "reportes.exportar", ...RESET],
};

// El rol se conserva para lo que aún lo usa (el superadmin y los listados de
// operadores). En un perfil nuevo se deduce de sus permisos.
function rolBase(permisos) {
  const p = new Set(permisos);
  if (p.has("produccion.escanear")) return "operador_produccion";
  if (p.has("embarque.escanear") || p.has("embarque.musical_po")) return "operador_embarque";
  if (p.has("pos.importar") || p.has("pos.enviar_t4")) return "operador_po";
  return "reportes";
}

// Permisos de cada usuario, con caché corta: un cambio de perfil se nota en
// segundos sin consultar la BD en cada petición.
const TTL_MS = 30 * 1000;
const cache = new Map();

function limpiarCache() {
  cache.clear();
}

async function deUsuario(user_id) {
  const guardado = cache.get(user_id);
  if (guardado && guardado.vence > Date.now()) return guardado.info;

  let fila;
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.rol, u.activo, p.id AS perfil_id, p.nombre AS perfil,
              COALESCE(array_agg(pp.permiso) FILTER (WHERE pp.permiso IS NOT NULL), '{}') AS permisos
         FROM users u
         LEFT JOIN perfiles p
           ON p.id = COALESCE(u.perfil_id, (SELECT id FROM perfiles WHERE clave = u.rol))
         LEFT JOIN perfil_permisos pp ON pp.perfil_id = p.id
        WHERE u.id = $1
        GROUP BY u.id, p.id`,
      [user_id],
    );
    fila = rows[0];
  } catch (err) {
    if (err.code !== "42P01") throw err; // 42P01: la tabla perfiles todavía no existe
    const { rows } = await pool.query("SELECT id, rol, activo FROM users WHERE id = $1", [user_id]);
    fila = rows[0] && { ...rows[0], perfil: null, permisos: POR_ROL[rows[0].rol] || [] };
  }

  const info = fila && {
    rol: fila.rol,
    activo: fila.activo,
    perfil_id: fila.perfil_id || null,
    perfil: fila.perfil || null,
    permisos: new Set(fila.rol === "superadmin" ? TODOS : fila.permisos),
  };
  cache.set(user_id, { info, vence: Date.now() + TTL_MS });
  return info;
}

// Lo que el frontend necesita para armar menú y botones.
async function sesion(user) {
  const info = await deUsuario(user.id);
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    rol: info.rol,
    perfil: info.perfil || (info.rol === "superadmin" ? "Administrador" : null),
    permisos: [...info.permisos],
  };
}

module.exports = { CATALOGO, TODOS, RESET, POR_ROL, rolBase, deUsuario, sesion, limpiarCache };
