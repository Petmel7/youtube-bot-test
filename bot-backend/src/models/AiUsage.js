const mongoose = require("mongoose");

const aiAttemptSchema = new mongoose.Schema({
    attempt: { type: Number, required: true },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    latencyMs: { type: Number, default: null },
    providerErrorCode: { type: String, default: null },
    providerStatus: { type: Number, default: null },
    finishReason: { type: String, default: null },
    promptTokens: { type: Number, default: null },
    outputTokens: { type: Number, default: null },
    thoughtsTokenCount: { type: Number, default: null },
    totalTokens: { type: Number, default: null },
    retryDelayMs: { type: Number, default: null },
    retryExhausted: { type: Boolean, default: null }
}, { _id: false });

const aiUsageSchema = new mongoose.Schema({
    operationKey: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: "BotRun", required: true, index: true },
    videoId: { type: String },
    commentId: { type: String },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    promptTokens: { type: Number, default: null },
    outputTokens: { type: Number, default: null },
    thoughtsTokenCount: { type: Number, default: null },
    totalTokens: { type: Number, default: null },
    estimatedCredits: { type: Number, default: null },
    reservedCredits: { type: Number, default: null },
    actualCredits: { type: Number, default: null },
    reservationKey: { type: String, default: null },
    debitKey: { type: String, default: null },
    releaseKey: { type: String, default: null },
    billingStatus: {
        type: String,
        enum: [
            "NOT_BILLED",
            "RESERVED",
            "PROVIDER_FAILED",
            "USAGE_RECORDED",
            "CHARGE_FINALIZED",
            "RESERVATION_RELEASED",
            "ACCOUNTING_RECOVERY_REQUIRED"
        ],
        default: "NOT_BILLED"
    },
    finishReason: { type: String, default: null },
    providerErrorCode: { type: String, default: null },
    providerStatus: { type: Number, default: null },
    providerErrorCategory: { type: String, default: null },
    attemptCount: { type: Number, default: null },
    retryExhausted: { type: Boolean, default: null },
    attempts: { type: [aiAttemptSchema], default: [] },
    latencyMs: { type: Number, default: null },
    success: { type: Boolean, required: true },
    errorCode: { type: String, default: null }
}, { timestamps: true });

aiUsageSchema.index({ userId: 1, createdAt: -1 });
aiUsageSchema.index({ provider: 1, model: 1, createdAt: -1 });

const AiUsage = mongoose.model("AiUsage", aiUsageSchema, "aiusage");

module.exports = AiUsage;
