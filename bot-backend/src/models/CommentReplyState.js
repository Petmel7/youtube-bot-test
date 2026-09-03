const mongoose = require("mongoose");

const commentReplyStateSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    videoId: { type: String, required: true, index: true },
    commentId: { type: String, required: true, index: true },
    status: {
        type: String,
        enum: ["queued", "processing", "drafted", "replied", "posted", "failed", "skipped"],
        required: true,
        default: "drafted",
        index: true
    },
    taskType: {
        type: String,
        enum: ["bulk-reply", "single-reply", "draft", "manual"],
        default: null,
        index: true
    },
    commentTextSnapshot: { type: String, default: null, maxlength: 1000 },
    draftReplyText: { type: String, default: null, maxlength: 10000 },
    postedReplyTextSnapshot: { type: String, default: null, maxlength: 1000 },
    youtubeReplyId: { type: String, default: null },
    editCount: { type: Number, default: 0 },
    lastEditedAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
    lastErrorMessage: { type: String, default: null },
    generatedByAi: { type: Boolean, default: false },
    botRunId: { type: mongoose.Schema.Types.ObjectId, ref: "BotRun", default: null },
    attempts: { type: Number, default: 0 },
    lockedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    idempotencyKey: { type: String, default: null },
    draftIdempotencyKey: { type: String, default: null },
    publishIdempotencyKey: { type: String, default: null },
    editIdempotencyKey: { type: String, default: null }
}, { timestamps: true });

commentReplyStateSchema.index({ userId: 1, videoId: 1, commentId: 1 }, { unique: true });
commentReplyStateSchema.index({ botRunId: 1, status: 1, updatedAt: 1 });
commentReplyStateSchema.index(
    { userId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);
commentReplyStateSchema.index(
    { userId: 1, draftIdempotencyKey: 1 },
    { unique: true, partialFilterExpression: { draftIdempotencyKey: { $type: "string" } } }
);
commentReplyStateSchema.index(
    { userId: 1, publishIdempotencyKey: 1 },
    { unique: true, partialFilterExpression: { publishIdempotencyKey: { $type: "string" } } }
);
commentReplyStateSchema.index(
    { userId: 1, editIdempotencyKey: 1 },
    { unique: true, partialFilterExpression: { editIdempotencyKey: { $type: "string" } } }
);

module.exports = mongoose.model("CommentReplyState", commentReplyStateSchema);
