const supervisorService = require("../services/supervisorService");

const responder = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

module.exports = {
  listar: responder(() => supervisorService.listar()),
  crear: responder((req) => supervisorService.crear(req.body.nombre, req.user.id)),
  regenerar: responder((req) => supervisorService.regenerar(req.params.id)),
  actualizar: responder((req) => supervisorService.actualizar(req.params.id, req.body)),
  verificar: responder((req) => supervisorService.verificar(req.body.codigo)),
  motivos: responder(async () => supervisorService.MOTIVOS),
  liberarCaja: responder((req) =>
    supervisorService.liberarCaja(req.params.id, req.body, req.user.id),
  ),
  reporteLiberaciones: responder((req) =>
    supervisorService.reporteLiberaciones(req.query),
  ),
};
