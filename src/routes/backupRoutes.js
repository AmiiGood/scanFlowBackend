const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const backupController = require("../controllers/backupController");

router.post("/generate", authenticate, permiso("backup.generar"), backupController.generate);

module.exports = router;
