const {
    rateLimitWindowMs,
    rateLimitGlobalMax,
    rateLimitAuthMax,
    rateLimitBotMax,
    rateLimitYoutubeMax,
    rateLimitAdminMax
} = require("../config/config");
const { createRateLimiter } = require("./rateLimit");

const createConfiguredRateLimiters = (options = {}) => ({
    global: createRateLimiter({
        group: "global",
        windowMs: rateLimitWindowMs,
        max: rateLimitGlobalMax,
        ...options
    }),
    auth: createRateLimiter({
        group: "auth",
        windowMs: rateLimitWindowMs,
        max: rateLimitAuthMax,
        ...options
    }),
    bot: createRateLimiter({
        group: "bot",
        windowMs: rateLimitWindowMs,
        max: rateLimitBotMax,
        ...options
    }),
    youtube: createRateLimiter({
        group: "youtube",
        windowMs: rateLimitWindowMs,
        max: rateLimitYoutubeMax,
        ...options
    }),
    admin: createRateLimiter({
        group: "admin",
        windowMs: rateLimitWindowMs,
        max: rateLimitAdminMax,
        ...options
    })
});

module.exports = {
    createConfiguredRateLimiters
};
