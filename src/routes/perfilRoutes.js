const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const c = require("../controllers/perfilController");

router.use(authenticate, permiso("usuarios.administrar"));

router.get("/permisos", c.catalogo);
router.get("/", c.listar);
router.post("/", c.crear);
router.put("/:id", c.actualizar);
router.delete("/:id", c.eliminar);

module.exports = router;
