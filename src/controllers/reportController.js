const reportService = require("../services/reportService");
const { enviarExcel } = require("../services/excelStream");

async function resumenGeneral(req, res) {
  try {
    const result = await reportService.resumenGeneral();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function progresoPorPO(req, res) {
  try {
    const result = await reportService.progresoPorPO(req.params.po_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function actividadReciente(req, res) {
  try {
    const limite = parseInt(req.query.limite) || 50;
    const result = await reportService.actividadReciente(limite);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function produccionPorOperador(req, res) {
  try {
    const result = await reportService.produccionPorOperador();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function skusSinQRs(req, res) {
  try {
    const result = await reportService.skusSinQRs();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function produccionPorDia(req, res) {
  try {
    const { dias } = req.query;
    const result = await reportService.produccionPorDia(dias);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function trazabilidadQR(req, res) {
  try {
    const result = await reportService.trazabilidadQR(req.params.codigo);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function cajasPorSKU(req, res) {
  try {
    const result = await reportService.cajasPorSKU(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function cartonesPendientesPorPO(req, res) {
  try {
    const result = await reportService.cartonesPendientesPorPO(
      req.params.po_id,
    );
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function qrsSinSKU(req, res) {
  try {
    const result = await reportService.qrsSinSKU(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function qrsSinSKUPorUPC(req, res) {
  try {
    res.json(await reportService.qrsSinSKUPorUPC());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function historialEnviosT4(req, res) {
  try {
    const result = await reportService.historialEnviosT4();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function detalleCartonesPorPO(req, res) {
  try {
    const result = await reportService.detalleCartonesPorPO(req.params.po_id);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}

async function posParaReportes(req, res) {
  try {
    const result = await reportService.posParaReportes(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function detalleCajasQR(req, res) {
  try {
    const result = await reportService.detalleCajasQR(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function detalleQRs(req, res) {
  try {
    res.json(await reportService.detalleQRs(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Excel de los reportes por QR, armado en el servidor (ver excelStream.js).
const EXCEL_CAJA_QR = [
  { titulo: "fecha", campo: "escaneado_at", tipo: "fecha", ancho: 12 },
  { titulo: "hora", campo: "escaneado_at", tipo: "hora", ancho: 14 },
  { titulo: "turno", campo: "turno", ancho: 10 },
  { titulo: "usuario", campo: "usuario", ancho: 16 },
  { titulo: "codigo_qr", campo: "codigo_qr", ancho: 42 },
  { titulo: "token", campo: "token", ancho: 16 },
  { titulo: "caja", campo: "codigo_caja", ancho: 34 },
  { titulo: "sku", campo: "sku_number", ancho: 18 },
  { titulo: "talla", campo: "size", ancho: 8 },
];

const EXCEL_QR = [
  { titulo: "fecha", campo: "escaneado_at", tipo: "fecha", ancho: 12 },
  { titulo: "hora", campo: "escaneado_at", tipo: "hora", ancho: 14 },
  { titulo: "turno", campo: "turno", ancho: 10 },
  { titulo: "usuario", campo: "usuario", ancho: 16 },
  { titulo: "codigo_qr", campo: "codigo_qr", ancho: 42 },
  { titulo: "token", campo: "token", ancho: 16 },
  { titulo: "upc", campo: "upc", ancho: 15 },
  { titulo: "estado_qr", campo: "qr_estado", ancho: 11 },
  { titulo: "sku", campo: "sku_number", ancho: 18 },
  { titulo: "style_no", campo: "style_no", ancho: 10 },
  { titulo: "estilo", campo: "style_name", ancho: 24 },
  { titulo: "color", campo: "color_name", ancho: 16 },
  { titulo: "talla", campo: "size", ancho: 8 },
  { titulo: "caja", campo: "codigo_caja", ancho: 34 },
  { titulo: "estado_caja", campo: "caja_estado", ancho: 11 },
  { titulo: "como_se_embarco", campo: "como_se_embarco", ancho: 24 },
  { titulo: "carton", campo: "carton_id", ancho: 22 },
  { titulo: "tipo_carton", campo: "carton_tipo", ancho: 11 },
  { titulo: "estado_carton", campo: "carton_estado", ancho: 12 },
  { titulo: "fecha_embarque", campo: "embarcado_at", tipo: "fecha", ancho: 14 },
  { titulo: "hora_embarque", campo: "embarcado_at", tipo: "hora", ancho: 14 },
  { titulo: "usuario_embarque", campo: "usuario_embarque", ancho: 16 },
  { titulo: "po", campo: "po_number", ancho: 12 },
  { titulo: "estado_po", campo: "po_estado", ancho: 11 },
  { titulo: "cfm_xf_date", campo: "cfm_xf_date", tipo: "fecha", ancho: 12 },
  { titulo: "fecha_envio_t4", campo: "enviado_t4_at", tipo: "fecha", ancho: 14 },
  { titulo: "hora_envio_t4", campo: "enviado_t4_at", tipo: "hora", ancho: 14 },
];

function excel(nombre, columnas, consulta) {
  return async (req, res) => {
    try {
      const { sql, params } = await consulta(req.query, { soloConsulta: true });
      await enviarExcel(res, { nombre, columnas, sql, params });
    } catch (err) {
      // Con el archivo ya en camino solo queda cortar la descarga.
      if (res.headersSent) return res.destroy(err);
      res.removeHeader("Content-Disposition");
      res.status(500).type("json").json({ error: err.message });
    }
  };
}

const detalleCajasQRExcel = excel("detalle-caja-qr", EXCEL_CAJA_QR, reportService.detalleCajasQR);
const detalleQRsExcel = excel("detalle-qr", EXCEL_QR, reportService.detalleQRs);

async function usuariosReporte(req, res) {
  try {
    res.json(await reportService.usuariosReporte());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function dashboard(req, res) {
  try {
    res.json(await reportService.dashboard());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  usuariosReporte,
  dashboard,
  posParaReportes,
  detalleCajasQR,
  detalleQRs,
  detalleCajasQRExcel,
  detalleQRsExcel,
  resumenGeneral,
  progresoPorPO,
  actividadReciente,
  produccionPorOperador,
  skusSinQRs,
  produccionPorDia,
  trazabilidadQR,
  cajasPorSKU,
  cartonesPendientesPorPO,
  qrsSinSKU,
  qrsSinSKUPorUPC,
  historialEnviosT4,
  detalleCartonesPorPO,
};
