const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authController = require("../controllers/authController");

router.post("/login", authController.login);
router.post("/refresh", authController.refresh);
router.post("/logout", authController.logout);
// Sesión vigente: perfil y permisos (el frontend arma menú y botones con esto).
router.get("/me", authenticate, authController.me);

module.exports = router;
