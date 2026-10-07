const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const resetController = require("../controllers/resetController");

const soloAdmin = authorize("superadmin");

router.get("/buscar",      authenticate, soloAdmin, resetController.buscar);
router.delete("/caja/:id",   authenticate, soloAdmin, resetController.resetCaja);
router.delete("/carton/:id", authenticate, soloAdmin, resetController.resetCarton);
router.delete("/po/:id",     authenticate, soloAdmin, resetController.resetPO);

module.exports = router;
