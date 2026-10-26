const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const cajaController = require("../controllers/cajaController");
const supervisorController = require("../controllers/supervisorController");

const produccion = permiso("produccion.escanear");
// Embarque también consulta cajas (por su etiqueta) para asignarlas.
const consultar = permiso("produccion.escanear", "embarque.escanear", "embarque.musical_po");

router.get("/", authenticate, consultar, cajaController.getCajas);
router.get("/buscar/:codigo", authenticate, consultar, cajaController.buscarCaja);
router.post("/", authenticate, produccion, cajaController.iniciarCaja);
router.get("/:id", authenticate, consultar, cajaController.getProgreso);
router.post("/:id/scan", authenticate, produccion, cajaController.escanearQR);
router.post("/:id/liberar", authenticate, produccion, supervisorController.liberarCaja);

module.exports = router;
