
const express = require("express");
const { startBotController, getBotRunController, getBotCostEstimateController } = require("../controllers/botController");
const { isAuthenticated, requireYouTubeConnection } = require("../middleware/auth");
const requireWriteHeader = require("../middleware/requireWriteHeader");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.post("/cost-estimate", isAuthenticated, requireYouTubeConnection, asyncHandler(getBotCostEstimateController));
router.post("/start", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(startBotController));
router.get("/runs/:runId", isAuthenticated, asyncHandler(getBotRunController));

module.exports = router;
