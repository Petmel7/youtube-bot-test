const crypto = require("node:crypto");

const TOKEN_BYTES = 32;

const createCsrfToken = (req) => {
    if (!req.session) {
        throw new Error("Session middleware is required for CSRF tokens");
    }

    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    }

    return req.session.csrfToken;
};

const safeCompare = (left, right) => {
    if (typeof left !== "string" || typeof right !== "string") {
        return false;
    }

    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const verifyCsrfToken = (req, token) => safeCompare(req.session?.csrfToken, token);

module.exports = {
    createCsrfToken,
    verifyCsrfToken
};
