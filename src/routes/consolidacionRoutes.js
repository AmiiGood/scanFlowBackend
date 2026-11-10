const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const consolidacionController = require("../controllers/consolidacionController");

const consolidar = permiso("almacen.consolidar");

// La caja que se va a llenar se busca por su etiqueta (?codigo=...).
router.get("/destino", authenticate, consolidar, consolidacionController.buscarDestino);
router.post("/:destino_id/caja", authenticate, consolidar, consolidacionController.consolidarCaja);
router.post("/:destino_id/qr", authenticate, consolidar, consolidacionController.consolidarQR);

module.exports = router;
