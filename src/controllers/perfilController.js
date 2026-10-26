const perfilService = require("../services/perfilService");
const permisosService = require("../services/permisosService");

const responder = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

module.exports = {
  catalogo: responder(async () => permisosService.CATALOGO),
  listar: responder(() => perfilService.listar()),
  crear: responder((req) => perfilService.crear(req.body)),
  actualizar: responder((req) => perfilService.actualizar(req.params.id, req.body, req.user)),
  eliminar: responder((req) => perfilService.eliminar(req.params.id)),
};
