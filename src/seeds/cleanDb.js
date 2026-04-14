require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const pool = require("../config/database");

async function main() {
  console.log("🗑️  Limpiando base de datos...\n");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tablas = [
      "escaneos",
      "codigos_qr",
      "cajas",
      "carton_detalles",
      "cartones",
      "purchase_orders",
      "skus",
      "envios_trysor",
      "import_jobs",
      "refresh_tokens",
    ];
    for (const tabla of tablas) {
      await client.query(`TRUNCATE TABLE ${tabla} RESTART IDENTITY CASCADE`);
      console.log(`✅ ${tabla} limpiada`);
    }
    await client.query("COMMIT");
    console.log("\n✅ Base de datos limpia (usuarios conservados)");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
