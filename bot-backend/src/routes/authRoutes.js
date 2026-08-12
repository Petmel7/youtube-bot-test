
const express = require("express");
const passport = require("passport");
const { googleAuthCallback, logout, getStatus } = require("../controllers/authcontroller");
const requireWriteHeader = require("../middleware/requireWriteHeader");
const { getClientUrl } = require("../utils/env");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/google", passport.authenticate("google", {
    scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/youtube.force-ssl"
    ],
    accessType: "offline",
    prompt: "consent"
}));

router.get("/google/callback",
    passport.authenticate("google", { failureRedirect: `${getClientUrl()}/` }),
    asyncHandler(googleAuthCallback)
);

router.post("/logout", requireWriteHeader, logout);
router.get("/status", getStatus);

module.exports = router;
