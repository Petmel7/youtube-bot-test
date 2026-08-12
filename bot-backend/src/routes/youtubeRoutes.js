const express = require("express");
const { isAuthenticated } = require("../middleware/auth");
const { fetchUserVideos } = require("../controllers/youtubeController");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/my-videos", isAuthenticated, asyncHandler(fetchUserVideos));

module.exports = router;
