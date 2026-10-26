const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const resetController = require("../controllers/resetController");

// Cada acción tiene su permiso. Sin "reset.sin_gafete", además se pide el
// gafete de un supervisor (se valida en el controlador). Todo queda en reseteos.
const algunReset = permiso("reset.caja", "reset.desasociar", "reset.carton", "reset.po");

router.get("/buscar", authenticate, algunReset, resetController.buscar);
router.get("/motivos", authenticate, algunReset, resetController.motivos);
router.delete("/caja/:id", authenticate, permiso("reset.caja"), resetController.resetCaja);
router.post("/caja/:id/desasociar", authenticate, permiso("reset.desasociar"), resetController.desasociarCaja);
router.delete("/carton/:id", authenticate, permiso("reset.carton"), resetController.resetCarton);
router.delete("/po/:id", authenticate, permiso("reset.po"), resetController.resetPO);

module.exports = router;
