const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const upload = require("../middleware/upload");
const poController = require("../controllers/poController");

router.get("/", authenticate, poController.getAll);
router.get("/:id", authenticate, poController.getOne);
router.post(
  "/import",
  authenticate,
  permiso("pos.importar"),
  upload.single("file"),
  poController.importPOs,
);

module.exports = router;
