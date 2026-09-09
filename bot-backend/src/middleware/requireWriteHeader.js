const { forbidden } = require("../utils/errors");
const { verifyCsrfToken } = require("../services/security/csrfService");

const requireWriteHeader = (req, res, next) => {
    const token = req.get("X-CSRF-Token");
    if (token && verifyCsrfToken(req, token)) {
        return next();
    }

    if (process.env.NODE_ENV !== "production" && req.get("X-CSRF-Protection") === "1") {
        return next();
    }

    return next(forbidden(token ? "CSRF_TOKEN_INVALID" : "CSRF_TOKEN_REQUIRED", "Invalid or missing CSRF token"));
};

module.exports = requireWriteHeader;
