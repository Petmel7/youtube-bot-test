const { unauthorized, forbidden } = require("../utils/errors");

const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated() && req.user) {
        return next();
    }

    next(unauthorized());
};

const requireYouTubeConnection = (req, res, next) => {
    if (req.user?.tokens?.refresh_token || req.user?.tokens?.access_token) {
        return next();
    }

    next(forbidden("YOUTUBE_NOT_CONNECTED", "YouTube authorization is required"));
};

module.exports = { isAuthenticated, requireYouTubeConnection };
