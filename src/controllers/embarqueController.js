const embarqueService = require("../services/embarqueService");

async function asignarCaja(req, res) {
  try {
    const { caja_id } = req.body;
    if (!caja_id) return res.status(400).json({ error: "caja_id requerido" });
    const result = await embarqueService.asignarCajaACarton(
      caja_id,
      req.params.id,
      req.user.id,
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function reasociarQR(req, res) {
  try {
    const { codigo_qr } = req.body;
    if (!codigo_qr)
      return res.status(400).json({ error: "codigo_qr requerido" });
    const result = await embarqueService.reasociarQRaMusical(
      req.params.id,
      codigo_qr,
      req.user.id,
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function getCarton(req, res) {
  try {
    const result = await embarqueService.getCarton(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function getCartonesPorPO(req, res) {
  try {
    const result = await embarqueService.getCartonesPorPO(req.params.po_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function getProgresoMusical(req, res) {
  try {
    const result = await embarqueService.getProgresoMusical(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function buscarCarton(req, res) {
  try {
    const result = await embarqueService.buscarCarton(req.params.codigo);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function getResumenPO(req, res) {
  try {
    const result = await embarqueService.getResumenPO(req.params.po_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

const responder = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
};

const buscarPOMusical = responder((req) =>
  embarqueService.buscarPOMusical(req.query.po_number),
);
const getResumenMusical = responder((req) =>
  embarqueService.getResumenMusical(req.params.po_id),
);
const asignarCajaAPOMusical = responder((req) => {
  if (!req.body.codigo_caja) throw { status: 400, message: "codigo_caja requerido" };
  return embarqueService.asignarCajaAPOMusical(req.params.po_id, req.body.codigo_caja, req.user.id);
});
const asignarQRAPOMusical = responder((req) => {
  if (!req.body.codigo_qr) throw { status: 400, message: "codigo_qr requerido" };
  return embarqueService.asignarQRAPOMusical(req.params.po_id, req.body.codigo_qr, req.user.id);
});

module.exports = {
  buscarPOMusical,
  getResumenMusical,
  asignarCajaAPOMusical,
  asignarQRAPOMusical,
  asignarCaja,
  reasociarQR,
  getCarton,
  getCartonesPorPO,
  getProgresoMusical,
  buscarCarton,
  getResumenPO,
};
