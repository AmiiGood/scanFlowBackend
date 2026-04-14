const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const r = require("../controllers/reportController");

const admin = authorize("superadmin");
const adminEmbarque = authorize("superadmin", "operador_embarque");

router.get("/resumen", authenticate, admin, r.resumenGeneral);
router.get("/actividad", authenticate, admin, r.actividadReciente);
router.get("/operadores", authenticate, admin, r.produccionPorOperador);
router.get("/skus-sin-qr", authenticate, admin, r.skusSinQRs);
router.get("/produccion-dia", authenticate, admin, r.produccionPorDia);
router.get("/cajas-sku", authenticate, admin, r.cajasPorSKU);
router.get("/qrs-sin-sku", authenticate, admin, r.qrsSinSKU);
router.get("/envios-t4", authenticate, admin, r.historialEnviosT4);
router.get("/trazabilidad/:codigo", authenticate, admin, r.trazabilidadQR);
router.get("/po/:po_id/progreso", authenticate, adminEmbarque, r.progresoPorPO);
router.get(
  "/po/:po_id/pendientes",
  authenticate,
  adminEmbarque,
  r.cartonesPendientesPorPO,
);

module.exports = router;
