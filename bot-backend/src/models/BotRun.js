const mongoose = require("mongoose");

const resultSchema = new mongoose.Schema({
    commentId: { type: String, required: true },
    status: { type: String, enum: ["drafted", "replied", "skipped", "failed"], required: true },
    errorCode: String,
    errorMessage: String,
    commentTextSnapshot: { type: String, default: null },
    replyTextSnapshot: { type: String, default: null },
    draftReplyText: { type: String, default: null },
    youtubeReplyId: { type: String, default: null },
    generatedByAi: { type: Boolean, default: null },
    aiLatencyMs: { type: Number, default: null },
    youtubeInsertLatencyMs: { type: Number, default: null },
    attemptCount: { type: Number, default: null }
}, { _id: false, timestamps: true });

const botRunSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    videoId: { type: String, required: true, index: true },
    mode: { type: String, enum: ["bulk", "single-comment"], default: "bulk", index: true },
    status: {
        type: String,
        enum: ["queued", "running", "completed", "partial", "failed", "cancelled"],
        required: true,
        default: "queued",
        index: true
    },
    idempotencyKey: { type: String, required: true },
    processedCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
    errorCode: String,
    errorMessage: String,
    results: { type: [resultSchema], default: [] },
    startedAt: Date,
    completedAt: Date
}, { timestamps: true });

botRunSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
botRunSchema.index({ userId: 1, createdAt: -1 });
botRunSchema.index(
    { userId: 1, videoId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: { $in: ["queued", "running"] } } }
);

const BotRun = mongoose.model("BotRun", botRunSchema);

module.exports = BotRun;
