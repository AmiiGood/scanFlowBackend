const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const r = require("../controllers/reportController");
const supervisorController = require("../controllers/supervisorController");

// "reportes" es un rol de solo consulta: reportes y dashboard, nada más.
const admin = authorize("superadmin", "operador_po", "reportes");
const adminEmbarque = authorize(
  "superadmin",
  "operador_embarque",
  "operador_po",
  "reportes",
);

router.get("/resumen", authenticate, admin, r.resumenGeneral);
router.get("/dashboard", authenticate, admin, r.dashboard);
router.get("/actividad", authenticate, admin, r.actividadReciente);
router.get("/operadores", authenticate, admin, r.produccionPorOperador);
router.get("/skus-sin-qr", authenticate, admin, r.skusSinQRs);
router.get("/produccion-dia", authenticate, admin, r.produccionPorDia);
router.get("/cajas-sku", authenticate, admin, r.cajasPorSKU);
router.get("/qrs-sin-sku", authenticate, admin, r.qrsSinSKU);
router.get("/qrs-sin-sku/upcs", authenticate, admin, r.qrsSinSKUPorUPC);
router.get("/pos", authenticate, admin, r.posParaReportes);
router.get("/detalle-cajas", authenticate, admin, r.detalleCajasQR);
router.get(
  "/liberaciones",
  authenticate,
  admin,
  supervisorController.reporteLiberaciones,
);
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
