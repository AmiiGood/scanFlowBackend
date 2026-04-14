const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const upload = require("../middleware/upload");
const skuController = require("../controllers/skuController");

router.get("/", authenticate, skuController.getAll);
router.get("/:id", authenticate, skuController.getOne);
router.post(
  "/import",
  authenticate,
  authorize("superadmin"),
  upload.single("file"),
  skuController.importSkus,
);

module.exports = router;
