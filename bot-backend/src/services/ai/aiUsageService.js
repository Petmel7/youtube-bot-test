const crypto = require("crypto");
const AiUsage = require("../../models/AiUsage");

const normalizeId = (value) => String(value?._id || value || "");

const buildOperationKey = ({ userId, runId, commentId, provider, model }) => {
    const rawKey = [
        normalizeId(userId),
        normalizeId(runId),
        commentId || "",
        provider || "",
        model || ""
    ].join(":");

    return crypto.createHash("sha256").update(rawKey).digest("hex");
};

const nullableNumber = (value) => Number.isFinite(value) ? value : null;

const recordAiUsage = async (operation, result, model = AiUsage) => {
    const operationKey = operation.operationKey || buildOperationKey(operation);
    const usage = result.usage || {};
    const doc = {
        operationKey,
        userId: operation.userId,
        runId: operation.runId,
        videoId: operation.videoId,
        commentId: operation.commentId,
        provider: operation.provider,
        model: operation.model,
        promptTokens: nullableNumber(usage.promptTokens),
        outputTokens: nullableNumber(usage.outputTokens),
        totalTokens: nullableNumber(usage.totalTokens),
        estimatedCredits: nullableNumber(result.estimatedCredits),
        reservedCredits: nullableNumber(result.reservedCredits),
        actualCredits: nullableNumber(result.actualCredits),
        reservationKey: result.reservationKey || null,
        debitKey: result.debitKey || null,
        releaseKey: result.releaseKey || null,
        billingStatus: result.billingStatus || "NOT_BILLED",
        finishReason: result.finishReason || null,
        providerErrorCode: result.providerErrorCode || null,
        providerStatus: nullableNumber(result.providerStatus),
        providerErrorCategory: result.providerErrorCategory || null,
        attemptCount: nullableNumber(result.attemptCount),
        retryExhausted: result.retryExhausted === undefined ? null : Boolean(result.retryExhausted),
        latencyMs: nullableNumber(result.latencyMs),
        success: Boolean(result.success),
        errorCode: result.errorCode || null
    };

    return model.findOneAndUpdate(
        { operationKey },
        { $setOnInsert: doc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

const updateAiUsageBillingStatus = async (operationKey, update, model = AiUsage) => model.updateOne(
    { operationKey },
    {
        $set: {
            billingStatus: update.billingStatus,
            errorCode: update.errorCode || null,
            actualCredits: nullableNumber(update.actualCredits),
            ...(update.reservationKey ? { reservationKey: update.reservationKey } : {}),
            ...(update.debitKey ? { debitKey: update.debitKey } : {}),
            ...(update.releaseKey ? { releaseKey: update.releaseKey } : {})
        }
    }
);

const getAiUsageByOperationKey = (operationKey, model = AiUsage) => model.findOne({ operationKey });

module.exports = {
    buildOperationKey,
    getAiUsageByOperationKey,
    recordAiUsage,
    updateAiUsageBillingStatus
};
