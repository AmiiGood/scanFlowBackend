const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const s = require("../controllers/supervisorController");

const produccion = authorize("operador_produccion", "superadmin");
const soloAdmin = authorize("superadmin");

// Producción: validar el gafete y conocer los motivos antes de liberar una caja.
router.post("/verificar", authenticate, produccion, s.verificar);
router.get("/motivos", authenticate, produccion, s.motivos);

// Administración de supervisores y sus gafetes.
router.get("/", authenticate, soloAdmin, s.listar);
router.post("/", authenticate, soloAdmin, s.crear);
router.patch("/:id", authenticate, soloAdmin, s.actualizar);
router.post("/:id/regenerar", authenticate, soloAdmin, s.regenerar);

module.exports = router;
