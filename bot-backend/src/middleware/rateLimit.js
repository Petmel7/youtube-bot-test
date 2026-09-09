const { tooManyRequests } = require("../utils/errors");

const stores = new Map();

const getClientIp = (req) => req.ip || req.socket?.remoteAddress || "unknown";
const getSafePath = (req) => req.path || req.originalUrl?.split("?")[0] || req.url?.split("?")[0] || "unknown";

const defaultKeyGenerator = (req) => {
    const userId = req.user?._id || req.user?.id;
    return userId ? `user:${userId}` : `ip:${getClientIp(req)}`;
};

const createRateLimiter = ({
    group,
    windowMs,
    max,
    keyGenerator = defaultKeyGenerator,
    logger = console
}) => {
    const store = stores.get(group) || new Map();
    stores.set(group, store);

    return (req, res, next) => {
        const now = Date.now();
        const key = keyGenerator(req);
        const entry = store.get(key);
        const current = entry && entry.resetAt > now
            ? entry
            : { count: 0, resetAt: now + windowMs };

        current.count += 1;
        store.set(key, current);

        const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        res.set("X-RateLimit-Limit", String(max));
        res.set("X-RateLimit-Remaining", String(Math.max(max - current.count, 0)));
        res.set("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));

        if (current.count > max) {
            res.set("Retry-After", String(retryAfterSeconds));
            logger.warn?.("Rate limit exceeded", {
                group,
                keyType: key.startsWith("user:") ? "user" : "ip",
                path: getSafePath(req),
                method: req.method
            });
            return next(tooManyRequests("RATE_LIMITED", "Too many requests. Please try again later.", { group }));
        }

        next();
    };
};

const resetRateLimitStores = () => stores.clear();

module.exports = {
    createRateLimiter,
    resetRateLimitStores,
    defaultKeyGenerator
};
