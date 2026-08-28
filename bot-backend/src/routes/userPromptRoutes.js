
const express = require("express");
const { addUserPrompt, updateUserPrompt, getUserPrompt, updateUserGender } = require("../controllers/userPromptController");
const { isAuthenticated } = require("../middleware/auth");
const requireWriteHeader = require("../middleware/requireWriteHeader");
const asyncHandler = require("../middleware/asyncHandler");
const noCache = require("../middleware/noCache");

const router = express.Router();

router.get("/", noCache, isAuthenticated, asyncHandler(getUserPrompt));
router.post("/add", isAuthenticated, requireWriteHeader, asyncHandler(addUserPrompt));
router.put("/update", isAuthenticated, requireWriteHeader, asyncHandler(updateUserPrompt));
router.put("/update-gender", isAuthenticated, requireWriteHeader, asyncHandler(updateUserGender));

module.exports = router;
