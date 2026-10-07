const pool = require("../config/database");

// Etiqueta de caja: codigoUnico$SKU$cantidadPares$secuencial. El secuencial
// puede traer una letra de prefijo en reimpresiones (ej. "R2068").
const CAJA_RE = /^\d+\$[A-Z0-9-]+\$\d+\$[A-Z]?\d+$/;

function normalizeCodigoCaja(codigo) {
  return String(codigo).replace(/['{]/g, "-").trim().toUpperCase();
}

function parseCodgoCaja(codigo) {
  const normalized = normalizeCodigoCaja(codigo);

  // Si el QR del par se lee antes de que cargue la caja, llega pegado al
  // código de la caja (ej. "...$R2068HTTPSÑ--SCAN.CROCS.COM-Q-...").
  if (/HTTPS?|CROCS\.COM/.test(normalized))
    throw {
      status: 400,
      message:
        "El código de caja trae un QR pegado. Vuelve a escanear solo la etiqueta de la caja",
    };

  if (!CAJA_RE.test(normalized))
    throw {
      status: 400,
      message:
        "Formato de caja inválido. Esperado: codigoUnico$sku$cantidadPares$secuencial",
    };

  const [codigoUnico, skuRaw, cantidadPares, secuencial] = normalized.split("$");
  if (parseInt(cantidadPares) <= 0)
    throw {
      status: 400,
      message: "La cantidad de pares de la caja debe ser mayor a 0",
    };

  return {
    codigo: normalized,
    codigoUnico,
    sku: normalizeSku(skuRaw),
    cantidadPares: parseInt(cantidadPares),
    secuencial: parseInt(secuencial.match(/\d+/)[0]),
  };
}

function normalizeSku(sku) {
  return sku.replace(/['{]/g, "-").toUpperCase();
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

// `db` es el cliente de la transacción del escaneo: FOR UPDATE bloquea el QR
// para que una segunda lectura simultánea vea el estado ya actualizado.
async function validateQR(codigo_qr, sku_id, db = pool) {
  const normalizado = normalizeQR(codigo_qr);
  const { rows } = await db.query(
    "SELECT * FROM codigos_qr WHERE codigo_qr = $1 FOR UPDATE",
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

module.exports = {
  parseCodgoCaja,
  validateQR,
  normalizeQR,
  normalizeCodigoCaja,
};
