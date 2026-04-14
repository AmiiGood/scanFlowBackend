const pool = require("../config/database");

function parseCodgoCaja(codigo) {
  const normalized = codigo.replace(/['{]/g, "-");
  const parts = normalized.split("$");
  if (parts.length !== 4)
    throw {
      status: 400,
      message:
        "Formato de caja inválido. Esperado: codigoUnico$sku$cantidadPares$secuencial",
    };
  const [codigoUnico, skuRaw, cantidadPares, secuencial] = parts;
  if (!codigoUnico || !skuRaw || !cantidadPares || !secuencial) {
    throw {
      status: 400,
      message: "Todos los campos del código de caja son requeridos",
    };
  }
  return {
    codigoUnico,
    sku: normalizeSku(skuRaw),
    cantidadPares: parseInt(cantidadPares),
    secuencial: parseInt(secuencial),
  };
}

function normalizeSku(sku) {
  return sku.replace(/['{]/g, "-");
}

function normalizeQR(codigo) {
  // Escáneres con teclado en español mapean `:` → `Ñ` y `/` → `-`
  // Detectar si parece URL mal codificada: empieza con http o https (con o sin Ñ/-)
  if (/^https?Ñ/i.test(codigo) || /^https?-/i.test(codigo)) {
    return codigo
      .replace(/Ñ/gi, ":")
      .replace(/-/g, "/");
  }
  return codigo;
}

async function validateQR(codigo_qr, sku_id) {
  const normalizado = normalizeQR(codigo_qr);
  const { rows } = await pool.query(
    "SELECT * FROM codigos_qr WHERE codigo_qr = $1",
    [normalizado],
  );
  const qr = rows[0];
  if (!qr) throw { status: 404, message: "QR no encontrado" };
  if (qr.estado !== "disponible")
    throw { status: 409, message: `QR ya fue ${qr.estado}` };
  if (qr.sku_id !== sku_id)
    throw {
      status: 400,
      message: "El UPC del QR no corresponde al SKU de la caja",
    };
  return qr;
}

module.exports = { parseCodgoCaja, validateQR, normalizeQR };
