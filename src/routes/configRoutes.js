const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const configController = require("../controllers/configController");

router.get("/", authenticate, configController.getConfiguraciones);
router.put("/:clave", authenticate, permiso("config.editar"), configController.updateConfiguracion);

module.exports = router;
