const { unauthorized, forbidden } = require("../utils/errors");
const { hasYouTubeConnection } = require("../services/authService");

const isAuthenticated = (req, res, next) => {
    if (req.isAuthenticated() && req.user) {
        return next();
    }

    next(unauthorized());
};

const requireYouTubeConnection = (req, res, next) => {
    hasYouTubeConnection(req.user)
        .then((connected) => {
            if (connected) {
                return next();
            }

            return next(forbidden("YOUTUBE_NOT_CONNECTED", "YouTube authorization is required"));
        })
        .catch(next);
};

module.exports = { isAuthenticated, requireYouTubeConnection };
