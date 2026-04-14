const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const cajaController = require("../controllers/cajaController");

const soloProduccion = authorize("operador_produccion", "superadmin");

router.get(
  "/",
  authenticate,
  authorize("operador_produccion", "operador_embarque", "superadmin"),
  cajaController.getCajas,
);
router.post("/", authenticate, soloProduccion, cajaController.iniciarCaja);
router.get(
  "/:id",
  authenticate,
  authorize("operador_produccion", "operador_embarque", "superadmin"),
  cajaController.getProgreso,
);
router.post(
  "/:id/scan",
  authenticate,
  soloProduccion,
  cajaController.escanearQR,
);

module.exports = router;
