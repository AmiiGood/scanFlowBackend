const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const embarqueController = require("../controllers/embarqueController");

const porCarton = permiso("embarque.escanear");
const musical = permiso("embarque.musical_po");
const cualquiera = permiso("embarque.escanear", "embarque.musical_po");

// Musicales por PO: se escribe la PO y se escanean las cajas (o QR por QR).
router.get("/musical/po", authenticate, musical, embarqueController.buscarPOMusical);
router.get("/musical/po/:po_id", authenticate, musical, embarqueController.getResumenMusical);
router.post("/musical/po/:po_id/caja", authenticate, musical, embarqueController.asignarCajaAPOMusical);
router.post("/musical/po/:po_id/qr", authenticate, musical, embarqueController.asignarQRAPOMusical);

router.get("/po/:po_id", authenticate, cualquiera, embarqueController.getCartonesPorPO);
router.get("/po/:po_id/resumen", authenticate, cualquiera, embarqueController.getResumenPO);
router.get("/buscar/:codigo", authenticate, porCarton, embarqueController.buscarCarton);
router.get("/:id", authenticate, porCarton, embarqueController.getCarton);
router.get("/:id/progreso-musical", authenticate, porCarton, embarqueController.getProgresoMusical);
router.post("/:id/asignar-caja", authenticate, porCarton, embarqueController.asignarCaja);
router.post("/:id/reasociar-qr", authenticate, porCarton, embarqueController.reasociarQR);

module.exports = router;
