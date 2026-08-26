const PaymentIntent = require("../../models/PaymentIntent");
const WalletTransaction = require("../../models/WalletTransaction");
const { paymentConfig } = require("../../config/config");
const { getEnabledPaymentMethods } = require("../../config/paymentMethods");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const paymentIntentStatuses = new Set(require("../../models/PaymentIntent").paymentIntentStatuses);
const walletTransactionTypes = new Set(["CREDIT", "DEBIT", "RESERVATION", "RELEASE", "REFUND", "ADJUSTMENT"]);

const clampLimit = (value, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return defaultLimit;
    return Math.min(parsed, maxLimit);
};

const encodeCursor = (doc) => {
    if (!doc?.createdAt || !doc?._id) return null;
    return Buffer.from(JSON.stringify({
        createdAt: new Date(doc.createdAt).toISOString(),
        id: String(doc._id)
    }), "utf8").toString("base64url");
};

const decodeCursor = (cursor) => {
    if (!cursor || typeof cursor !== "string") return null;

    try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        const createdAt = new Date(parsed.createdAt);
        if (Number.isNaN(createdAt.getTime()) || !parsed.id) return null;
        return { createdAt, id: parsed.id };
    } catch {
        return null;
    }
};

const cursorFilter = (cursor) => {
    const decoded = decodeCursor(cursor);
    if (!decoded) return {};

    return {
        $or: [
            { createdAt: { $lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, _id: { $lt: decoded.id } }
        ]
    };
};

const applyRecentQuery = async (query, { limit, cursor }) => {
    const requestedLimit = clampLimit(limit);
    const docs = await query
        .sort({ createdAt: -1, _id: -1 })
        .limit(requestedLimit + 1)
        .lean();

    const items = docs.slice(0, requestedLimit);
    return {
        items,
        nextCursor: docs.length > requestedLimit ? encodeCursor(items[items.length - 1]) : null,
        limit: requestedLimit,
        cursor: cursor || null
    };
};

const createAdminPaymentObservabilityService = ({
    PaymentIntentModel = PaymentIntent,
    WalletTransactionModel = WalletTransaction,
    config = paymentConfig
} = {}) => {
    const listPaymentMethods = async () => ({
        paymentMethods: getEnabledPaymentMethods(config)
    });

    const listRecentPaymentIntents = async ({ status, methodId, limit, cursor } = {}) => {
        const filter = {
            ...cursorFilter(cursor)
        };

        if (status && paymentIntentStatuses.has(status)) {
            filter.status = status;
        }

        if (methodId && /^[A-Za-z0-9_-]{1,80}$/.test(methodId)) {
            filter.paymentMethodId = methodId;
        }

        return applyRecentQuery(PaymentIntentModel.find(filter), { limit, cursor });
    };

    const listRecentLedgerEntries = async ({ type = "CREDIT", limit, cursor } = {}) => {
        const normalizedType = walletTransactionTypes.has(type) ? type : "CREDIT";
        const filter = {
            type: normalizedType,
            ...cursorFilter(cursor)
        };

        return applyRecentQuery(WalletTransactionModel.find(filter), { limit, cursor });
    };

    return {
        listPaymentMethods,
        listRecentPaymentIntents,
        listRecentLedgerEntries
    };
};

module.exports = createAdminPaymentObservabilityService();
module.exports.createAdminPaymentObservabilityService = createAdminPaymentObservabilityService;
module.exports.clampLimit = clampLimit;
