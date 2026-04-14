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

module.exports = { importQRs, getJobStatus, getRecentJobs, getStats, getOne };
