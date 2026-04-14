const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const trysorController = require("../controllers/trysorController");

const soloAdmin = authorize("superadmin");

router.post(
  "/import-qr",
  authenticate,
  soloAdmin,
  trysorController.importarQRs,
);
router.post(
  "/po/:po_id/enviar",
  authenticate,
  soloAdmin,
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
  soloAdmin,
  trysorController.historialEnvios,
);

module.exports = router;
