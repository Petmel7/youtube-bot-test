class AppError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
        this.isOperational = true;
    }
}

const badRequest = (code, message) => new AppError(400, code, message);
const unauthorized = (message = "Authentication required") => new AppError(401, "UNAUTHENTICATED", message);
const forbidden = (code, message) => new AppError(403, code, message);
const notFound = (code, message) => new AppError(404, code, message);
const conflict = (code, message) => new AppError(409, code, message);
const unprocessable = (code, message) => new AppError(422, code, message);
const tooManyRequests = (code, message) => new AppError(429, code, message);
const upstream = (code, message) => new AppError(502, code, message);
const unavailable = (code, message) => new AppError(503, code, message);

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
    unavailable
};
