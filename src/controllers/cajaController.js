const cajaService = require("../services/cajaService");
const pool = require("../config/database");

async function iniciarCaja(req, res) {
  try {
    const { codigo_caja } = req.body;
    if (!codigo_caja)
      return res.status(400).json({ error: "codigo_caja requerido" });
    const caja = await cajaService.iniciarCaja(codigo_caja, req.user.id);
    res.status(201).json(caja);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function escanearQR(req, res) {
  try {
    const { codigo_qr } = req.body;
    if (!codigo_qr)
      return res.status(400).json({ error: "codigo_qr requerido" });
    const result = await cajaService.escanearQR(
      req.params.id,
      codigo_qr,
      req.user.id,
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function getProgreso(req, res) {
  try {
    const result = await cajaService.getProgresoCaja(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function buscarCaja(req, res) {
  try {
    const result = await cajaService.buscarCajaPorCodigo(req.params.codigo);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function getCajas(req, res) {
  try {
    const { estado } = req.query;
    const conditions = [];
    const params = [];

    if (estado) {
      params.push(estado);
      conditions.push(`c.estado = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT c.*, s.sku_number, s.style_name, s.size,
        (SELECT COUNT(*) FROM escaneos e WHERE e.caja_id = c.id) AS escaneados
       FROM cajas c
       JOIN skus s ON s.id = c.sku_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT 100`,
      params,
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { iniciarCaja, escanearQR, getProgreso, getCajas, buscarCaja };
