const poImportService = require("../services/poImportService");
const pool = require("../config/database");

async function importPOs(req, res) {
  try {
    if (!req.file)
      return res.status(400).json({ error: "Archivo Excel requerido" });
    const result = await poImportService.importFromExcel(req.file.buffer);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getAll(req, res) {
  try {
    const { search = "", estado = "", page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`po.po_number ILIKE $${params.length}`);
    }

    if (estado) {
      params.push(estado);
      conditions.push(`po.estado = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows: total } = await pool.query(
      `SELECT COUNT(*) FROM purchase_orders po ${where}`,
      params,
    );

    params.push(parseInt(limit), offset);
    const { rows } = await pool.query(
      `SELECT po.*,
        COUNT(c.id) AS total_cartones,
        COUNT(c.id) FILTER (WHERE c.estado = 'completo') AS cartones_completos
       FROM purchase_orders po
       LEFT JOIN cartones c ON c.po_id = po.id
       ${where}
       GROUP BY po.id
       ORDER BY po.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
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
    const { rows } = await pool.query(
      "SELECT * FROM purchase_orders WHERE id = $1",
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: "PO no encontrada" });

    const { rows: cartones } = await pool.query(
      `SELECT c.*, 
        json_agg(json_build_object('sku_id', cd.sku_id, 'sku_number', s.sku_number, 'cantidad', cd.cantidad_por_carton)) AS detalles
       FROM cartones c
       JOIN carton_detalles cd ON cd.carton_id = c.id
       JOIN skus s ON s.id = cd.sku_id
       WHERE c.po_id = $1
       GROUP BY c.id
       ORDER BY c.carton_id`,
      [req.params.id],
    );

    res.json({ ...rows[0], cartones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { importPOs, getAll, getOne };
