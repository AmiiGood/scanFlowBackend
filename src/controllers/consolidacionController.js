const consolidacionService = require("../services/consolidacionService");

const responder = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

module.exports = {
  buscarDestino: responder((req) => consolidacionService.buscarDestino(req.query.codigo)),
  consolidarCaja: responder((req) => {
    if (!req.body.codigo_caja) throw { status: 400, message: "codigo_caja requerido" };
    return consolidacionService.consolidarCaja(req.params.destino_id, req.body.codigo_caja, req.user.id);
  }),
  consolidarQR: responder((req) => {
    if (!req.body.codigo_qr) throw { status: 400, message: "codigo_qr requerido" };
    return consolidacionService.consolidarQR(req.params.destino_id, req.body.codigo_qr, req.user.id);
  }),
  reporte: responder((req) => consolidacionService.reporte(req.query)),
};
