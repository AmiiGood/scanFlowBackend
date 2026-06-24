const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const upload = require("../middleware/upload");
const poController = require("../controllers/poController");

router.get("/", authenticate, poController.getAll);
router.get("/:id", authenticate, poController.getOne);
router.post(
  "/import",
  authenticate,
  authorize("superadmin", "operador_po"),
  upload.single("file"),
  poController.importPOs,
);

module.exports = router;
