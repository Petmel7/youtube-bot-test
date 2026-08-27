class AppError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.isOperational = true;
        if (details !== undefined) {
            this.details = details;
        }
    }
}

const badRequest = (code, message, details) => new AppError(400, code, message, details);
const unauthorized = (message = "Authentication required") => new AppError(401, "UNAUTHENTICATED", message);
const forbidden = (code, message, details) => new AppError(403, code, message, details);
const notFound = (code, message, details) => new AppError(404, code, message, details);
const conflict = (code, message, details) => new AppError(409, code, message, details);
const unprocessable = (code, message, details) => new AppError(422, code, message, details);
const tooManyRequests = (code, message, details) => new AppError(429, code, message, details);
const upstream = (code, message, details) => new AppError(502, code, message, details);
const unavailable = (code, message, details) => new AppError(503, code, message, details);
const paymentRequired = (code, message, details) => new AppError(402, code, message, details);
const accountingError = (code = "ACCOUNTING_ERROR", message = "Accounting operation failed", details) => new AppError(503, code, message, details);

module.exports = {
    AppError,
    badRequest,
    unauthorized,
    forbidden,
    notFound,
    conflict,
    unprocessable,
    tooManyRequests,
    upstream,
    unavailable,
    paymentRequired,
    accountingError
};
