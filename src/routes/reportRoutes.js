const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const r = require("../controllers/reportController");
const supervisorController = require("../controllers/supervisorController");
const resetController = require("../controllers/resetController");

// Pedir todo el reporte (all=1) es exportar a Excel. Va después de
// authenticate, dentro de cada cadena.
function exportar(req, res, next) {
  if (String(req.query.all) === "1" && !req.user.permisos.has("reportes.exportar"))
    return res.status(403).json({ error: "No tienes permiso para exportar reportes" });
  next();
}

const admin = [permiso("reportes.ver"), exportar];
const tablero = [permiso("dashboard.ver", "reportes.ver"), exportar];
// El avance de una PO lo usan también su detalle y Embarque.
const adminEmbarque = [permiso("reportes.ver", "pos.ver", "embarque.escanear", "embarque.musical_po"), exportar];

router.get("/resumen", authenticate, tablero, r.resumenGeneral);
router.get("/dashboard", authenticate, permiso("dashboard.ver"), exportar, r.dashboard);
router.get("/actividad", authenticate, tablero, r.actividadReciente);
router.get("/operadores", authenticate, tablero, r.produccionPorOperador);
router.get("/skus-sin-qr", authenticate, admin, r.skusSinQRs);
router.get("/produccion-dia", authenticate, admin, r.produccionPorDia);
router.get("/cajas-sku", authenticate, admin, r.cajasPorSKU);
router.get("/qrs-sin-sku", authenticate, admin, r.qrsSinSKU);
router.get("/qrs-sin-sku/upcs", authenticate, admin, r.qrsSinSKUPorUPC);
router.get("/pos", authenticate, admin, r.posParaReportes);
router.get("/detalle-cajas", authenticate, admin, r.detalleCajasQR);
router.get("/detalle-qrs", authenticate, admin, r.detalleQRs);
router.get("/detalle-cajas/excel", authenticate, permiso("reportes.ver"), permiso("reportes.exportar"), r.detalleCajasQRExcel);
router.get("/detalle-qrs/excel", authenticate, permiso("reportes.ver"), permiso("reportes.exportar"), r.detalleQRsExcel);
router.get("/usuarios", authenticate, admin, r.usuariosReporte);
router.get(
  "/liberaciones",
  authenticate,
  admin,
  supervisorController.reporteLiberaciones,
);
router.get("/reseteos", authenticate, admin, resetController.reporteReseteos);
router.get("/envios-t4", authenticate, admin, r.historialEnviosT4);
router.get("/trazabilidad/:codigo", authenticate, admin, r.trazabilidadQR);
router.get("/po/:po_id/progreso", authenticate, adminEmbarque, r.progresoPorPO);
router.get(
  "/po/:po_id/pendientes",
  authenticate,
  adminEmbarque,
  r.cartonesPendientesPorPO,
);
router.get(
  "/po/:po_id/detalle-cartones",
  authenticate,
  adminEmbarque,
  r.detalleCartonesPorPO,
);

module.exports = router;
