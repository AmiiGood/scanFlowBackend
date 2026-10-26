const router = require("express").Router();
const authenticate = require("../middleware/authenticate");
const permiso = require("../middleware/permiso");
const qrController = require("../controllers/qrController");

router.get("/stats", authenticate, qrController.getStats);
router.get(
  "/jobs",
  authenticate,
  permiso("qrs.importar"),
  qrController.getRecentJobs,
);
router.get(
  "/jobs/:job_id",
  authenticate,
  permiso("qrs.importar"),
  qrController.getJobStatus,
);
router.get("/:codigo", authenticate, qrController.getOne);
router.post(
  "/import",
  authenticate,
  permiso("qrs.importar"),
  qrController.importQRs,
);
router.post(
  "/match-skus",
  authenticate,
  permiso("qrs.importar"),
  qrController.matchQRsWithSkus,
);

module.exports = router;
