require("dotenv").config({
  path: require("path").resolve(__dirname, "../../.env"),
});
const pool = require("../config/database");

// SKU real basado en el formato de caja: 14012026$207013'410'J4$24$018
// SKU normalizado: 207013-410-J4
const SKUS = [
  {
    sku_number: "207013-410-J4",
    upc: "841158410041",
    style_no: "207013",
    style_name: "Classic Clog",
    color: "410",
    color_name: "Navy",
    size: "J4",
  },
  {
    sku_number: "207013-410-J5",
    upc: "841158410042",
    style_no: "207013",
    style_name: "Classic Clog",
    color: "410",
    color_name: "Navy",
    size: "J5",
  },
  {
    sku_number: "207013-410-J6",
    upc: "841158410043",
    style_no: "207013",
    style_name: "Classic Clog",
    color: "410",
    color_name: "Navy",
    size: "J6",
  },
];

// QRs en formato real del escáner (con Ñ y -)
// El sistema los normaliza a https://verify.crocs.com/Q/...
const QR_CODES = [
  // J4: 24 QRs para caja mono SKU
  ...Array.from({ length: 24 }, (_, i) => ({
    codigo_qr: `https://verify.crocs.com/Q/J4NAV${String(i + 1).padStart(6, "0")}`,
    sku: "207013-410-J4",
  })),
  // J5: 12 QRs para caja mono + 6 QRs para caja musical = 18 total
  ...Array.from({ length: 18 }, (_, i) => ({
    codigo_qr: `https://verify.crocs.com/Q/J5NAV${String(i + 1).padStart(6, "0")}`,
    sku: "207013-410-J5",
  })),
  // J6: 6 QRs para caja musical
  ...Array.from({ length: 6 }, (_, i) => ({
    codigo_qr: `https://verify.crocs.com/Q/J6NAV${String(i + 1).padStart(6, "0")}`,
    sku: "207013-410-J6",
  })),
];

async function main() {
  console.log("Insertando datos de prueba...\n");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. SKUs
    const skuIds = {};
    for (const sku of SKUS) {
      const { rows } = await client.query(
        `INSERT INTO skus (sku_number, upc, style_no, style_name, color, color_name, size)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (sku_number) DO UPDATE SET upc = EXCLUDED.upc
         RETURNING id, sku_number, upc`,
        [sku.sku_number, sku.upc, sku.style_no, sku.style_name, sku.color, sku.color_name, sku.size],
      );
      skuIds[sku.sku_number] = { id: rows[0].id, upc: rows[0].upc };
      console.log(`SKU: ${sku.sku_number}`);
    }

    // 2. QRs
    let qrCount = 0;
    for (const qr of QR_CODES) {
      const sku_id = skuIds[qr.sku].id;
      const upc = skuIds[qr.sku].upc;
      await client.query(
        `INSERT INTO codigos_qr (codigo_qr, upc, sku_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (codigo_qr) DO NOTHING`,
        [qr.codigo_qr, upc, sku_id],
      );
      qrCount++;
    }
    console.log(`QRs: ${qrCount} insertados`);

    // 3. Purchase Order
    const { rows: poRows } = await client.query(
      `INSERT INTO purchase_orders (po_number, cantidad_pares, cantidad_cartones, cfm_xf_date)
       VALUES ('PO-TEST-2026', 48, 3, '2026-06-30')
       ON CONFLICT (po_number) DO UPDATE SET cantidad_pares = EXCLUDED.cantidad_pares
       RETURNING id`,
    );
    const po_id = poRows[0].id;
    console.log(`PO: PO-TEST-2026 (id: ${po_id})`);

    // 4. Cartones
    const cartonesData = [
      // Mono SKU — exactamente 24 pares, que es lo que lleva la caja
      {
        carton_id: "00008835039535240364",
        tipo: "mono_sku",
        detalles: [{ sku: "207013-410-J4", cantidad: 24 }],
      },
      // Otro mono SKU
      {
        carton_id: "00008835039535240365",
        tipo: "mono_sku",
        detalles: [{ sku: "207013-410-J5", cantidad: 12 }],
      },
      // Musical con J5 y J6
      {
        carton_id: "00008835039535240366",
        tipo: "musical",
        detalles: [
          { sku: "207013-410-J5", cantidad: 6 },
          { sku: "207013-410-J6", cantidad: 6 },
        ],
      },
    ];

    for (const c of cartonesData) {
      const { rows: cRows } = await client.query(
        `INSERT INTO cartones (carton_id, po_id, tipo)
         VALUES ($1,$2,$3)
         ON CONFLICT (carton_id) DO UPDATE SET po_id = EXCLUDED.po_id
         RETURNING id`,
        [c.carton_id, po_id, c.tipo],
      );
      const carton_db_id = cRows[0].id;

      await client.query("DELETE FROM carton_detalles WHERE carton_id = $1", [carton_db_id]);
      for (const d of c.detalles) {
        await client.query(
          "INSERT INTO carton_detalles (carton_id, sku_id, cantidad_por_carton) VALUES ($1,$2,$3)",
          [carton_db_id, skuIds[d.sku].id, d.cantidad],
        );
      }
      console.log(`Carton: ${c.carton_id} (${c.tipo})`);
    }

    await client.query("COMMIT");

    // 5. Imprimir QRs en formato escáner
    console.log("\n=== QRs PARA ESCANEAR (formato escáner) ===");
    console.log("\n-- J4 (24 QRs para producción) --");
    for (let i = 1; i <= 24; i++) {
      console.log(`httpsÑ--verify.crocs.com-Q-J4NAV${String(i).padStart(6, "0")}`);
    }
    console.log("\n-- J5 (12 QRs) --");
    for (let i = 1; i <= 12; i++) {
      console.log(`httpsÑ--verify.crocs.com-Q-J5NAV${String(i).padStart(6, "0")}`);
    }
    console.log("\n-- J6 (12 QRs) --");
    for (let i = 1; i <= 12; i++) {
      console.log(`httpsÑ--verify.crocs.com-Q-J6NAV${String(i).padStart(6, "0")}`);
    }

    console.log("\n=== FLUJO DE PRUEBA ===");
    console.log("\n--- PRODUCCIÓN ---");
    console.log("Escanea código de caja (formato escáner 1):");
    console.log("  14012026$207013'410'J4$24$018");
    console.log("  o formato 2:");
    console.log("  14012026$207013{410{J4$24$018");
    console.log("\nLuego escanea 24 QRs, formato escáner:");
    console.log("  httpsÑ--verify.crocs.com-Q-J4NAV000001");
    console.log("  httpsÑ--verify.crocs.com-Q-J4NAV000002");
    console.log("  ... (hasta J4NAV000024)");
    console.log("\n--- EMBARQUE MONO SKU ---");
    console.log("Escanea cartón:");
    console.log("  00008835039535240364");
    console.log("Luego escanea la caja (mismo formato escáner):");
    console.log("  14012026$207013'410'J4$24$018");
    console.log("\n--- EMBARQUE MUSICAL ---");
    console.log("Escanea cartón:");
    console.log("  00008835039535240366");
    console.log("Luego escanea 6 QRs de J5 y 6 QRs de J6:");
    console.log("  httpsÑ--verify.crocs.com-Q-J5NAV000001 ... J5NAV000006");
    console.log("  httpsÑ--verify.crocs.com-Q-J6NAV000001 ... J6NAV000006");
    console.log("\nNota: los QRs musicales deben estar en estado 'escaneado'");
    console.log("(primero pasan por producción)");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error:", err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
