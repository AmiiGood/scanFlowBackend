const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const backupController = require("../controllers/backupController");

const soloAdmin = authorize("superadmin");

router.post("/generate", authenticate, soloAdmin, backupController.generate);

module.exports = router;
