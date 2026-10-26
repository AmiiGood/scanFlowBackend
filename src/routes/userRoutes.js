const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const userController = require("../controllers/userController");

router.use(authenticate, permiso("usuarios.administrar"));

router.get("/", userController.getAll);
router.get("/:id", userController.getOne);
router.post("/", userController.create);
router.put("/:id", userController.update);
router.patch("/:id/password", userController.changePassword);

module.exports = router;
