const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const trysorController = require("../controllers/trysorController");

router.post("/import-qr", authenticate, permiso("qrs.importar"), trysorController.importarQRs);
router.post("/po/:po_id/enviar", authenticate, permiso("pos.enviar_t4"), trysorController.enviarPO);
router.post("/po/:po_id/cancelar", authenticate, permiso("pos.cancelar_t4"), trysorController.cancelarPO);
router.get(
  "/po/:po_id/historial",
  authenticate,
  permiso("pos.ver", "pos.enviar_t4", "pos.cancelar_t4"),
  trysorController.historialEnvios,
);

module.exports = router;
