
const { findUserById, storeUserTokensInSession, hasYouTubeConnection } = require("../services/authService");
const { getClientUrl } = require("../utils/env");
const { toSafeUser } = require("../utils/dto");

const googleAuthCallback = async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, error: { code: "AUTH_FAILED", message: "Authentication failed" } });
    }

    const user = await findUserById(req.user.id);
    if (!user) {
        return res.status(401).json({ success: false, error: { code: "USER_NOT_FOUND", message: "User not found" } });
    }

    storeUserTokensInSession(req, user.id);
    res.redirect(`${getClientUrl()}/dashboard`);
};

const logout = (req, res, next) => {
    req.logout(err => {
        if (err) {
            return next(err);
        }
        req.session.destroy(() => {
            res.clearCookie("connect.sid");
            res.json({ success: true, message: "Logged out successfully" });
        });
    });
};

const getStatus = async (req, res) => {
    if (req.isAuthenticated()) {
        const youtubeConnected = await hasYouTubeConnection(req.user);
        const userObject = req.user.toObject?.() || req.user;
        res.json({
            success: true,
            connected: true,
            user: toSafeUser({ ...userObject, youtubeConnected })
        });
    } else {
        res.json({ success: true, connected: false, user: null });
    }
};

module.exports = {
    googleAuthCallback,
    logout,
    getStatus
};
