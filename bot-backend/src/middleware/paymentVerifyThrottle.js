const { paymentConfig } = require("../config/config");
const { tooManyRequests } = require("../utils/errors");

const getUserId = (req) => req.user?._id || req.user?.id || "anonymous";
const getIp = (req) => req.ip || req.socket?.remoteAddress || "unknown";

const createInMemoryPaymentVerifyThrottleStore = ({ now = () => Date.now() } = {}) => {
    const entries = new Map();

    return {
        async increment(key, windowMs) {
            const currentTime = now();
            const existing = entries.get(key);

            if (!existing || existing.resetAt <= currentTime) {
                const next = { count: 1, resetAt: currentTime + windowMs };
                entries.set(key, next);
                return next;
            }

            existing.count += 1;
            return existing;
        },
        clear() {
            entries.clear();
        },
        entries
    };
};

const normalizeStore = (store, now) => {
    if (store?.increment) return store;
    const map = store instanceof Map ? store : new Map();

    return {
        async increment(key, windowMs) {
            const currentTime = now();
            const existing = map.get(key);

            if (!existing || existing.resetAt <= currentTime) {
                const next = { count: 1, resetAt: currentTime + windowMs };
                map.set(key, next);
                return next;
            }

            existing.count += 1;
            return existing;
        },
        clear() {
            map.clear();
        },
        entries: map
    };
};

const createPaymentVerifyThrottle = ({
    windowMs = paymentConfig.verifyThrottleWindowMs,
    max = paymentConfig.verifyThrottleMax,
    now = () => Date.now(),
    store = createInMemoryPaymentVerifyThrottleStore({ now })
} = {}) => {
    const throttleStore = normalizeStore(store, now);

    const middleware = async (req, res, next) => {
        let result;
        try {
            const paymentIntentId = req.params?.id || "unknown-intent";
            const key = `${getUserId(req)}:${paymentIntentId}:${getIp(req)}`;
            result = await throttleStore.increment(key, windowMs);
        } catch (error) {
            return next(error);
        }

        if (result.count > max) {
            return next(tooManyRequests("PAYMENT_VERIFY_RATE_LIMITED", "Too many payment verification attempts"));
        }

        return next();
    };

    middleware.clear = () => throttleStore.clear();
    middleware.store = throttleStore;
    return middleware;
};

module.exports = createPaymentVerifyThrottle();
module.exports.createPaymentVerifyThrottle = createPaymentVerifyThrottle;
module.exports.createInMemoryPaymentVerifyThrottleStore = createInMemoryPaymentVerifyThrottleStore;
