const pool = require("../config/database");
const { callApi } = require("./trysorService");

async function importFromTrysor(lastGetTime = "2000-01-01 00:00:00") {
  const url = process.env.TRYSOR_API_URL;
  const appKey = process.env.TRYSOR_APP_KEY;
  const appSecret = process.env.TRYSOR_APP_SECRET;
  const method = "get_crocs_qr_upc";

  const response = await callApi(url, method, appKey, appSecret, {
    LastGetTime: lastGetTime,
  });

  if (!response || response.Success !== "true") {
    throw new Error("Error en respuesta Trysor: " + JSON.stringify(response));
  }

  const items =
    typeof response.Data === "string"
      ? JSON.parse(response.Data)
      : response.Data;

  if (!Array.isArray(items)) {
    throw new Error("Formato inesperado en Data: " + JSON.stringify(items));
  }

  let inserted = 0;
  let skipped = 0;
  const errors = [];

  const BATCH = 500;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (item) => {
        const codigo_qr = String(item.QrCode || "").trim();
        const upc = String(item.UPC || "").trim();

        if (!codigo_qr || !upc) {
          errors.push({ item, error: "QrCode o UPC vacío" });
          return;
        }

        try {
          const { rows: skuRows } = await pool.query(
            "SELECT id FROM skus WHERE upc = $1",
            [upc],
          );
          const sku_id = skuRows[0]?.id || null;

          const { rowCount } = await pool.query(
            `INSERT INTO codigos_qr (codigo_qr, upc, sku_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (codigo_qr) DO NOTHING`,
            [codigo_qr, upc, sku_id],
          );

          if (rowCount) inserted++;
          else skipped++;
        } catch (err) {
          errors.push({ codigo_qr, error: err.message });
        }
      }),
    );
  }

  return {
    total_api: items.length,
    inserted,
    skipped,
    errors: errors.slice(0, 50),
    total_errors: errors.length,
  };
}

async function launchImportJob(lastGetTime, user_id) {
  // Crear job en DB
  const { rows } = await pool.query(
    `INSERT INTO import_jobs (tipo, estado, parametros, created_by)
     VALUES ('qr_import', 'pendiente', $1, $2)
     RETURNING id`,
    [JSON.stringify({ lastGetTime }), user_id],
  );
  const job_id = rows[0].id;

  // Lanzar en background — no await
  runImportJob(job_id, lastGetTime).catch(() => {});

  return job_id;
}

async function runImportJob(job_id, lastGetTime) {
  await pool.query(
    `UPDATE import_jobs SET estado = 'procesando', started_at = NOW() WHERE id = $1`,
    [job_id],
  );

  try {
    const resultado = await importFromTrysor(lastGetTime);
    await pool.query(
      `UPDATE import_jobs SET estado = 'completado', resultado = $1, finished_at = NOW() WHERE id = $2`,
      [JSON.stringify(resultado), job_id],
    );
  } catch (err) {
    await pool.query(
      `UPDATE import_jobs SET estado = 'error', error = $1, finished_at = NOW() WHERE id = $2`,
      [err.message, job_id],
    );
  }
}

async function getJob(job_id) {
  const { rows } = await pool.query("SELECT * FROM import_jobs WHERE id = $1", [
    job_id,
  ]);
  return rows[0] || null;
}

async function getRecentJobs(limit = 10) {
  const { rows } = await pool.query(
    `SELECT id, tipo, estado, parametros, resultado, error, created_at, started_at, finished_at
     FROM import_jobs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

module.exports = { importFromTrysor, launchImportJob, getJob, getRecentJobs };
