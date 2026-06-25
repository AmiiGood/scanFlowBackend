const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const configController = require("../controllers/configController");

// Cualquier usuario autenticado puede leer la configuración
// (producción necesita el flag de bloqueo en tiempo real).
router.get("/", authenticate, configController.getConfiguraciones);

// Solo superadmin puede modificar la configuración.
router.put(
  "/:clave",
  authenticate,
  authorize("superadmin"),
  configController.updateConfiguracion,
);

module.exports = router;
