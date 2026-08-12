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


// const User = require("../models/User");

// const isAuthenticated = async (req, res, next) => {
//     if (req.isAuthenticated() && req.user) {
//         // Якщо req.user.tokens відсутні, підтягни з БД
//         if (!req.user.tokens || !req.user.tokens.access_token) {
//             const userFromDb = await User.findById(req.user._id);
//             if (userFromDb?.tokens) {
//                 req.user.tokens = userFromDb.tokens;
//             }
//         }
//         return next();
//     }

//     res.status(401).json({ error: "Unauthorized" });
// };

// module.exports = { isAuthenticated };



