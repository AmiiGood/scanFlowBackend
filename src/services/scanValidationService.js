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

function swapCase(str) {
  return str.replace(/[a-zA-Z]/g, (c) =>
    c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase(),
  );
}

function normalizeQR(codigo) {
  // Escáneres con teclado en español mapean `:` → `Ñ/ñ` y `/` → `-`
  // Detectar si parece URL mal codificada (con o sin Caps Lock)
  if (/^https?[Ññ]/i.test(codigo) || /^https?-/i.test(codigo)) {
    let result = codigo.replace(/[Ññ]/g, ":").replace(/-/g, "/");

    // Si Caps Lock estaba activo, el prefijo viene en mayúscula: invertir todo
    if (/^HTTPS?:\/\//.test(result)) {
      result = swapCase(result);
    }

    return result;
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
