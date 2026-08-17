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

module.exports = { buildOperationKey, recordAiUsage };
