const express = require("express");
const { getUsers, getUser, getUserRole } = require("../controllers/userController");
const { isAuthenticated } = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/users", isAuthenticated, requireAdmin, asyncHandler(getUsers));
router.get("/user", isAuthenticated, asyncHandler(getUser));
router.get("/user-role", isAuthenticated, asyncHandler(getUserRole));

module.exports = router;
