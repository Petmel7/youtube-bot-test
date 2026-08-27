const { AppError } = require("../utils/errors");

const errorHandler = (err, req, res, next) => {
    const isKnown = err instanceof AppError || err?.isOperational;
    const status = isKnown ? err.status : 500;
    const code = isKnown ? err.code : "INTERNAL_ERROR";
    const message = isKnown ? err.message : "Unexpected server error";

    if (!isKnown) {
        console.error("Unexpected error", {
            path: req.originalUrl,
            method: req.method,
            message: err?.message
        });
    }

    res.status(status).json({
        success: false,
        error: {
            code,
            message,
            ...(isKnown && err.details !== undefined ? { details: err.details } : {})
        }
    });
};

module.exports = errorHandler;
