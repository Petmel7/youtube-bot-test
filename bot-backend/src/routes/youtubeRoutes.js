const express = require("express");
const { isAuthenticated } = require("../middleware/auth");
const { fetchUserVideos, refreshUserVideos } = require("../controllers/youtubeController");
const asyncHandler = require("../middleware/asyncHandler");
const requireWriteHeader = require("../middleware/requireWriteHeader");

const router = express.Router();

router.get("/my-videos", isAuthenticated, asyncHandler(fetchUserVideos));
router.post("/my-videos/refresh", isAuthenticated, requireWriteHeader, asyncHandler(refreshUserVideos));

module.exports = router;
