const qrImportService = require("../services/qrImportService");
const pool = require("../config/database");

async function importQRs(req, res) {
  try {
    const { lastGetTime } = req.body;
    const job_id = await qrImportService.launchImportJob(
      lastGetTime || "2000-01-01 00:00:00",
      req.user.id,
    );
    res.json({ job_id, message: "Importación iniciada en background" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getJobStatus(req, res) {
  try {
    const job = await qrImportService.getJob(req.params.job_id);
    if (!job) return res.status(404).json({ error: "Job no encontrado" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getRecentJobs(req, res) {
  try {
    const jobs = await qrImportService.getRecentJobs();
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getStats(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE estado = 'disponible') AS disponibles,
        COUNT(*) FILTER (WHERE estado = 'escaneado') AS escaneados,
        COUNT(*) FILTER (WHERE estado = 'enviado') AS enviados,
        COUNT(*) AS total
       FROM codigos_qr`,
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getOne(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT qr.*, s.sku_number, s.style_name
       FROM codigos_qr qr
       LEFT JOIN skus s ON s.id = qr.sku_id
       WHERE qr.codigo_qr = $1`,
      [req.params.codigo],
    );
    if (!rows[0]) return res.status(404).json({ error: "QR no encontrado" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function matchQRsWithSkus(req, res) {
  const client = await pool.connect();
  try {
    const { rows: pendingRows } = await client.query(
      `SELECT COUNT(*)::int AS pendientes
         FROM codigos_qr
        WHERE sku_id IS NULL`,
    );
    const pendientes = pendingRows[0].pendientes;

    if (pendientes === 0) {
      return res.json({
        message: "No hay QRs pendientes de match",
        actualizados: 0,
        sin_match: 0,
        pendientes_antes: 0,
      });
    }

    await client.query("BEGIN");

    const { rowCount: actualizados } = await client.query(
      `UPDATE codigos_qr qr
          SET sku_id = s.id
         FROM skus s
        WHERE qr.sku_id IS NULL
          AND qr.upc = s.upc`,
    );

    await client.query("COMMIT");

    const { rows: restantesRows } = await client.query(
      `SELECT COUNT(*)::int AS sin_match
         FROM codigos_qr
        WHERE sku_id IS NULL`,
    );

    res.json({
      message: "Match completado",
      pendientes_antes: pendientes,
      actualizados,
      sin_match: restantesRows[0].sin_match,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

module.exports = {
  importQRs,
  getJobStatus,
  getRecentJobs,
  getStats,
  getOne,
  matchQRsWithSkus,
};
