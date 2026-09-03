
const express = require("express");
const {
    startBotController,
    getBotRunController,
    getBotCostEstimateController,
    replyToSingleCommentController,
    generateCommentDraftController,
    updateCommentDraftController,
    publishCommentReplyController,
    editPostedCommentReplyController,
    clearCommentDraftController,
    retryCommentTaskController
} = require("../controllers/botController");
const { isAuthenticated, requireYouTubeConnection } = require("../middleware/auth");
const requireWriteHeader = require("../middleware/requireWriteHeader");
const asyncHandler = require("../middleware/asyncHandler");
const noCache = require("../middleware/noCache");

const router = express.Router();

router.post("/cost-estimate", isAuthenticated, requireYouTubeConnection, asyncHandler(getBotCostEstimateController));
router.post("/start", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(startBotController));
router.post("/comments/:commentId/reply", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(replyToSingleCommentController));
router.put("/comments/:commentId/reply", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(editPostedCommentReplyController));
router.post("/comments/:commentId/draft", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(generateCommentDraftController));
router.put("/comments/:commentId/draft", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(updateCommentDraftController));
router.delete("/comments/:commentId/draft", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(clearCommentDraftController));
router.post("/comments/:commentId/publish", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(publishCommentReplyController));
router.post("/tasks/:taskId/retry", isAuthenticated, requireYouTubeConnection, requireWriteHeader, asyncHandler(retryCommentTaskController));
router.get("/runs/:runId", noCache, isAuthenticated, asyncHandler(getBotRunController));

module.exports = router;
