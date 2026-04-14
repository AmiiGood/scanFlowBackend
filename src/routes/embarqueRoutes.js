const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const embarqueController = require("../controllers/embarqueController");

const soloEmbarque = authorize("operador_embarque", "superadmin");

router.get(
  "/po/:po_id",
  authenticate,
  soloEmbarque,
  embarqueController.getCartonesPorPO,
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
