const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const authorize = require("../middleware/authorize");
const qrController = require("../controllers/qrController");

router.get("/stats", authenticate, qrController.getStats);
router.get(
  "/jobs",
  authenticate,
  authorize("superadmin"),
  qrController.getRecentJobs,
);
router.get(
  "/jobs/:job_id",
  authenticate,
  authorize("superadmin"),
  qrController.getJobStatus,
);
router.get("/:codigo", authenticate, qrController.getOne);
router.post(
  "/import",
  authenticate,
  authorize("superadmin"),
  qrController.importQRs,
);

module.exports = router;
