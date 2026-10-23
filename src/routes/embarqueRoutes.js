const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const embarqueController = require("../controllers/embarqueController");

const soloEmbarque = authorize("operador_embarque", "superadmin");

// Musicales por PO: se escribe la PO y se escanean las cajas (o QR por QR).
router.get("/musical/po", authenticate, soloEmbarque, embarqueController.buscarPOMusical);
router.get("/musical/po/:po_id", authenticate, soloEmbarque, embarqueController.getResumenMusical);
router.post("/musical/po/:po_id/caja", authenticate, soloEmbarque, embarqueController.asignarCajaAPOMusical);
router.post("/musical/po/:po_id/qr", authenticate, soloEmbarque, embarqueController.asignarQRAPOMusical);

router.get(
  "/po/:po_id",
  authenticate,
  soloEmbarque,
  embarqueController.getCartonesPorPO,
);
router.get(
  "/po/:po_id/resumen",
  authenticate,
  soloEmbarque,
  embarqueController.getResumenPO,
);
router.get(
  "/buscar/:codigo",
  authenticate,
  soloEmbarque,
  embarqueController.buscarCarton,
);
router.get("/:id", authenticate, soloEmbarque, embarqueController.getCarton);
router.get(
  "/:id/progreso-musical",
  authenticate,
  soloEmbarque,
  embarqueController.getProgresoMusical,
);
router.post(
  "/:id/asignar-caja",
  authenticate,
  soloEmbarque,
  embarqueController.asignarCaja,
);
router.post(
  "/:id/reasociar-qr",
  authenticate,
  soloEmbarque,
  embarqueController.reasociarQR,
);

module.exports = router;
