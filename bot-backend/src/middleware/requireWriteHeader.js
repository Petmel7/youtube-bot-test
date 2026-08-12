const { forbidden } = require("../utils/errors");

const requireWriteHeader = (req, res, next) => {
    if (req.get("X-CSRF-Protection") !== "1") {
        return next(forbidden("CSRF_HEADER_REQUIRED", "Missing required write request header"));
    }

    next();
};

module.exports = requireWriteHeader;
