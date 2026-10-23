const resetService = require("../services/resetService");
const supervisorService = require("../services/supervisorService");

// Todo reset lleva motivo. El superadmin no necesita gafete; los demás roles
// (Consulta de reportes) necesitan el de un supervisor activo.
async function autorizar(req) {
  const { codigo, motivo } = req.body || {};
  const comentario = String(req.body?.comentario || "").trim().slice(0, 500);
  if (!resetService.MOTIVOS[motivo])
    throw { status: 400, message: "Elige el motivo del reset" };
  if (motivo === "otro" && !comentario)
    throw { status: 400, message: "Describe el motivo del reset" };

  let supervisor = null;
  if (req.user.rol !== "superadmin") {
    if (!codigo) throw { status: 400, message: "Falta el gafete del supervisor" };
    supervisor = await supervisorService.verificar(codigo);
  }
  return {
    motivo,
    comentario: comentario || null,
    supervisor_id: supervisor?.id || null,
    supervisor: supervisor?.nombre || null,
    user_id: req.user.id,
  };
}

const responder = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const conAutorizacion = (accion) =>
  responder(async (req) => {
    const auditoria = await autorizar(req);
    const resultado = await accion(req.params.id, auditoria);
    return auditoria.supervisor ? { ...resultado, autorizo: auditoria.supervisor } : resultado;
  });

module.exports = {
  resetCaja: conAutorizacion(resetService.resetCaja),
  resetCarton: conAutorizacion(resetService.resetCarton),
  resetPO: conAutorizacion(resetService.resetPO),
  desasociarCaja: conAutorizacion(resetService.desasociarCaja),
  buscar: responder((req) => resetService.buscar(req.query.tipo, req.query.q)),
  motivos: responder(async () => resetService.MOTIVOS),
  reporteReseteos: responder((req) => resetService.reporteReseteos(req.query)),
};
