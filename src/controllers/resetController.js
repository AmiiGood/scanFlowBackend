const resetService = require("../services/resetService");

async function resetCaja(req, res) {
  try {
    const result = await resetService.resetCaja(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function resetCarton(req, res) {
  try {
    const result = await resetService.resetCarton(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function resetPO(req, res) {
  try {
    const result = await resetService.resetPO(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { resetCaja, resetCarton, resetPO };
