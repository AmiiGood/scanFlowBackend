const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const resetController = require("../controllers/resetController");

// El superadmin resetea con motivo; "reportes" además con el gafete de un
// supervisor (se valida en el controlador). Todo queda en la tabla reseteos.
const puedeResetear = authorize("superadmin", "reportes");

router.get("/buscar", authenticate, puedeResetear, resetController.buscar);
router.get("/motivos", authenticate, puedeResetear, resetController.motivos);
router.delete("/caja/:id", authenticate, puedeResetear, resetController.resetCaja);
router.post("/caja/:id/desasociar", authenticate, puedeResetear, resetController.desasociarCaja);
router.delete("/carton/:id", authenticate, puedeResetear, resetController.resetCarton);
router.delete("/po/:id", authenticate, puedeResetear, resetController.resetPO);

module.exports = router;
