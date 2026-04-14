const trysorSendService = require("../services/trysorSendService");
const qrImportService = require("../services/qrImportService");

async function enviarPO(req, res) {
  try {
    const result = await trysorSendService.enviarPOaT4(req.params.po_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function cancelarPO(req, res) {
  try {
    const result = await trysorSendService.cancelarPOenT4(req.params.po_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function historialEnvios(req, res) {
  try {
    const result = await trysorSendService.getHistorialEnvios(req.params.po_id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function importarQRs(req, res) {
  try {
    const result = await qrImportService.importFromTrysor();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { enviarPO, cancelarPO, historialEnvios, importarQRs };
