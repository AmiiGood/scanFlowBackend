const XLSX = require("xlsx");
const pool = require("../config/database");

const REQUIRED_COLS = ["ArSKU", "UPC", "StyleNo", "StyleName", "Size"];

async function importFromExcel(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  if (!rows.length) throw new Error("El archivo está vacío");

  for (const col of REQUIRED_COLS) {
    if (!(col in rows[0]))
      throw new Error(`Columna requerida faltante: ${col}`);
  }

  let inserted = 0;
  let updated = 0;
  const errors = [];

  for (const [i, row] of rows.entries()) {
    const lineNum = i + 2;
    const sku_number = String(row.ArSKU || "").trim();
    const upc = String(row.UPC || "").trim();

    if (!sku_number || !upc) {
      errors.push({ linea: lineNum, error: "ArSKU y UPC son requeridos" });
      continue;
    }

    try {
      const { rowCount } = await pool.query(
        `INSERT INTO skus (sku_number, upc, style_no, style_name, color, color_name, size)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (sku_number) DO UPDATE SET
           upc = EXCLUDED.upc,
           style_no = EXCLUDED.style_no,
           style_name = EXCLUDED.style_name,
           color = EXCLUDED.color,
           color_name = EXCLUDED.color_name,
           size = EXCLUDED.size
         RETURNING (xmax = 0) AS is_insert`,
        [
          sku_number,
          upc,
          row.StyleNo ? String(row.StyleNo) : null,
          row.StyleName ? String(row.StyleName) : null,
          row.Color ? String(row.Color) : null,
          row.ColorName ? String(row.ColorName) : null,
          row.Size ? String(row.Size) : null,
        ],
      );
      // xmax = 0 significa INSERT, cualquier otro valor es UPDATE
      if (rowCount) inserted++;
      else updated++;
    } catch (err) {
      errors.push({ linea: lineNum, sku: sku_number, error: err.message });
    }
  }

  return { inserted, updated, errors, total: rows.length };
}

module.exports = { importFromExcel };
