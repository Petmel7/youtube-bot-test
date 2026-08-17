const mongoose = require("mongoose");

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
    totalTokens: { type: Number, default: null },
    estimatedCredits: { type: Number, default: null },
    reservedCredits: { type: Number, default: null },
    actualCredits: { type: Number, default: null },
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
    latencyMs: { type: Number, default: null },
    success: { type: Boolean, required: true },
    errorCode: { type: String, default: null }
}, { timestamps: true });

aiUsageSchema.index({ userId: 1, createdAt: -1 });
aiUsageSchema.index({ provider: 1, model: 1, createdAt: -1 });

const AiUsage = mongoose.model("AiUsage", aiUsageSchema, "aiusage");

module.exports = AiUsage;
