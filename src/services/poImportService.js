const XLSX = require("xlsx");
const pool = require("../config/database");

function parseExcelDate(value) {
  if (!value) return null;
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return new Date(date.y, date.m - 1, date.d);
  }
  if (typeof value === "string") {
    const [d, m, y] = value.split("/");
    if (d && m && y) return new Date(`${y}-${m}-${d}`);
  }
  return null;
}

async function importFromExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  const poSheet = workbook.Sheets["Po"];
  const cartonSheet = workbook.Sheets["Cartones"];

  if (!poSheet) throw new Error('Hoja "Po" no encontrada');
  if (!cartonSheet) throw new Error('Hoja "Cartones" no encontrada');

  const poRows = XLSX.utils.sheet_to_json(poSheet, { defval: null });
  const cartonRows = XLSX.utils.sheet_to_json(cartonSheet, {
    defval: null,
    raw: true,
  });

  if (!poRows.length) throw new Error('La hoja "Po" está vacía');
  if (!cartonRows.length) throw new Error('La hoja "Cartones" está vacía');

  const results = [];

  for (const poRow of poRows) {
    const po_number = String(poRow.PONumber || "").trim();
    if (!po_number) continue;

    const cantidad_pares = parseInt(poRow.CantidadPares);
    const cantidad_cartones = parseInt(poRow.CantidadCartones);
    const cfm_xf_date = parseExcelDate(poRow.CfmXfDate);

    if (isNaN(cantidad_pares) || isNaN(cantidad_cartones)) {
      results.push({
        po_number,
        error: "CantidadPares o CantidadCartones inválidos",
      });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: poInserted } = await client.query(
        `INSERT INTO purchase_orders (po_number, cantidad_pares, cantidad_cartones, cfm_xf_date)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (po_number) DO UPDATE SET
           cantidad_pares = EXCLUDED.cantidad_pares,
           cantidad_cartones = EXCLUDED.cantidad_cartones,
           cfm_xf_date = EXCLUDED.cfm_xf_date
         RETURNING id`,
        [po_number, cantidad_pares, cantidad_cartones, cfm_xf_date],
      );

      const po_id = poInserted[0].id;

      const cartonesDePo = cartonRows.filter(
        (r) => String(r.PONumber || "").trim() === po_number,
      );

      // Agrupar por CartonID para detectar tipo
      const cartonMap = new Map();
      for (const r of cartonesDePo) {
        const carton_id = String(r.CartonID || "").trim();
        const sku_number = String(r.SKU || "").trim();
        const cantidad = parseInt(r.CantidadPorCarton);

        if (!carton_id || !sku_number || isNaN(cantidad)) continue;

        if (!cartonMap.has(carton_id)) cartonMap.set(carton_id, []);
        cartonMap.get(carton_id).push({ sku_number, cantidad });
      }

      let cartones_insertados = 0;
      const carton_errors = [];

      for (const [carton_id, detalles] of cartonMap.entries()) {
        const skus_unicos = [...new Set(detalles.map((d) => d.sku_number))];
        const tipo = skus_unicos.length > 1 ? "musical" : "mono_sku";

        // Validar que todos los SKUs existen
        const skuIds = {};
        let skuError = false;
        for (const sku_number of skus_unicos) {
          const { rows } = await client.query(
            "SELECT id FROM skus WHERE sku_number = $1",
            [sku_number],
          );
          if (!rows[0]) {
            carton_errors.push({
              carton_id,
              error: `SKU no encontrado: ${sku_number}`,
            });
            skuError = true;
            break;
          }
          skuIds[sku_number] = rows[0].id;
        }
        if (skuError) continue;

        const { rows: cartonInserted } = await client.query(
          `INSERT INTO cartones (carton_id, po_id, tipo)
           VALUES ($1, $2, $3)
           ON CONFLICT (carton_id) DO UPDATE SET po_id = EXCLUDED.po_id, tipo = EXCLUDED.tipo
           RETURNING id`,
          [carton_id, po_id, tipo],
        );

        const carton_db_id = cartonInserted[0].id;

        await client.query("DELETE FROM carton_detalles WHERE carton_id = $1", [
          carton_db_id,
        ]);

        for (const { sku_number, cantidad } of detalles) {
          await client.query(
            "INSERT INTO carton_detalles (carton_id, sku_id, cantidad_por_carton) VALUES ($1, $2, $3)",
            [carton_db_id, skuIds[sku_number], cantidad],
          );
        }

        cartones_insertados++;
      }

      await client.query("COMMIT");
      results.push({ po_number, po_id, cartones_insertados, carton_errors });
    } catch (err) {
      await client.query("ROLLBACK");
      results.push({ po_number, error: err.message });
    } finally {
      client.release();
    }
  }

  return results;
}

module.exports = { importFromExcel };
