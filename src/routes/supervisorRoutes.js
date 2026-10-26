const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const s = require("../controllers/supervisorController");

const administrar = permiso("supervisores.administrar");

// Validar un gafete: al liberar una caja en Producción o al resetear.
router.post(
  "/verificar",
  authenticate,
  permiso("produccion.escanear", "reset.caja", "reset.desasociar", "reset.carton", "reset.po"),
  s.verificar,
);
router.get("/motivos", authenticate, permiso("produccion.escanear"), s.motivos);

// Administración de supervisores y sus gafetes.
router.get("/", authenticate, administrar, s.listar);
router.post("/", authenticate, administrar, s.crear);
router.patch("/:id", authenticate, administrar, s.actualizar);
router.post("/:id/regenerar", authenticate, administrar, s.regenerar);

module.exports = router;
