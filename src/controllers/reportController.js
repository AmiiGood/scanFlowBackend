const reportService = require("../services/reportService");

async function resumenGeneral(req, res) {
  try {
    const result = await reportService.resumenGeneral();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function progresoPorPO(req, res) {
  try {
    const result = await reportService.progresoPorPO(req.params.po_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function actividadReciente(req, res) {
  try {
    const limite = parseInt(req.query.limite) || 50;
    const result = await reportService.actividadReciente(limite);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function produccionPorOperador(req, res) {
  try {
    const result = await reportService.produccionPorOperador();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function skusSinQRs(req, res) {
  try {
    const result = await reportService.skusSinQRs();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function produccionPorDia(req, res) {
  try {
    const { dias } = req.query;
    const result = await reportService.produccionPorDia(dias);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function trazabilidadQR(req, res) {
  try {
    const result = await reportService.trazabilidadQR(req.params.codigo);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function cajasPorSKU(req, res) {
  try {
    const result = await reportService.cajasPorSKU(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function cartonesPendientesPorPO(req, res) {
  try {
    const result = await reportService.cartonesPendientesPorPO(
      req.params.po_id,
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function qrsSinSKU(req, res) {
  try {
    const result = await reportService.qrsSinSKU(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function historialEnviosT4(req, res) {
  try {
    const result = await reportService.historialEnviosT4();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  resumenGeneral,
  progresoPorPO,
  actividadReciente,
  produccionPorOperador,
  skusSinQRs,
  produccionPorDia,
  trazabilidadQR,
  cajasPorSKU,
  cartonesPendientesPorPO,
  qrsSinSKU,
  historialEnviosT4,
};
