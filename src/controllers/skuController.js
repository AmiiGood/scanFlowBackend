const skuImportService = require("../services/skuImportService");
const pool = require("../config/database");

async function importSkus(req, res) {
  try {
    if (!req.file)
      return res.status(400).json({ error: "Archivo Excel requerido" });
    const result = await skuImportService.importFromExcel(req.file.buffer);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getAll(req, res) {
  try {
    const { search = "", page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(sku_number ILIKE $${params.length} OR upc ILIKE $${params.length} OR style_name ILIKE $${params.length})`,
      );
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: total } = await pool.query(
      `SELECT COUNT(*) FROM skus ${where}`,
      params,
    );

    params.push(parseInt(limit), offset);
    const { rows } = await pool.query(
      `SELECT * FROM skus ${where} ORDER BY sku_number LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({
      data: rows,
      total: parseInt(total[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(parseInt(total[0].count) / parseInt(limit)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOne(req, res) {
  try {
    const { rows } = await pool.query("SELECT * FROM skus WHERE id = $1", [
      req.params.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: "SKU no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { importSkus, getAll, getOne };
