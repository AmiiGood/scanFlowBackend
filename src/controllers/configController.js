const configService = require("../services/configService");

async function getConfiguraciones(req, res) {
  try {
    const config = await configService.getAll();
    res.json(config);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function updateConfiguracion(req, res) {
  try {
    const { clave } = req.params;
    const { valor } = req.body;
    if (valor === undefined || valor === null) {
      return res.status(400).json({ error: "valor requerido" });
    }
    const result = await configService.set(clave, valor, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

module.exports = { getConfiguraciones, updateConfiguracion };
