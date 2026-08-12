const { forbidden } = require("../utils/errors");

const requireAdmin = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return next(forbidden("ADMIN_REQUIRED", "Admin access required"));
    }

    next();
};

module.exports = requireAdmin;
