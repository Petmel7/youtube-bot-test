const { paymentConfig } = require("../config/config");
const { tooManyRequests } = require("../utils/errors");

const getUserId = (req) => req.user?._id || req.user?.id || "anonymous";
const getIp = (req) => req.ip || req.socket?.remoteAddress || "unknown";

const createPaymentVerifyThrottle = ({
    windowMs = paymentConfig.verifyThrottleWindowMs,
    max = paymentConfig.verifyThrottleMax,
    now = () => Date.now(),
    store = new Map()
} = {}) => {
    const middleware = (req, res, next) => {
        const paymentIntentId = req.params?.id || "unknown-intent";
        const key = `${getUserId(req)}:${paymentIntentId}:${getIp(req)}`;
        const currentTime = now();
        const existing = store.get(key);

        if (!existing || existing.resetAt <= currentTime) {
            store.set(key, { count: 1, resetAt: currentTime + windowMs });
            return next();
        }

        if (existing.count >= max) {
            return next(tooManyRequests("PAYMENT_VERIFY_RATE_LIMITED", "Too many payment verification attempts"));
        }

        existing.count += 1;
        return next();
    };

    middleware.clear = () => store.clear();
    middleware.store = store;
    return middleware;
};

module.exports = createPaymentVerifyThrottle();
module.exports.createPaymentVerifyThrottle = createPaymentVerifyThrottle;
