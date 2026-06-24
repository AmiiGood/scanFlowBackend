const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const trysorController = require("../controllers/trysorController");

const soloAdmin = authorize("superadmin");
const adminPO = authorize("superadmin", "operador_po");

router.post(
  "/import-qr",
  authenticate,
  soloAdmin,
  trysorController.importarQRs,
);
router.post(
  "/po/:po_id/enviar",
  authenticate,
  adminPO,
  trysorController.enviarPO,
);
router.post(
  "/po/:po_id/cancelar",
  authenticate,
  soloAdmin,
  trysorController.cancelarPO,
);
router.get(
  "/po/:po_id/historial",
  authenticate,
  adminPO,
  trysorController.historialEnvios,
);

module.exports = router;
