const mongoose = require("mongoose");

const actionValues = ["BOT_REPLY_EDITED"];

const commentReplyEditAuditSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    videoId: { type: String, required: true, index: true },
    commentId: { type: String, required: true, index: true },
    replyStateId: { type: mongoose.Schema.Types.ObjectId, ref: "CommentReplyState", required: true, index: true },
    botRunId: { type: mongoose.Schema.Types.ObjectId, ref: "BotRun", default: null, index: true },
    youtubeReplyId: { type: String, required: true },
    action: { type: String, enum: actionValues, required: true },
    beforeTextSnapshot: { type: String, default: null, maxlength: 1000 },
    afterTextSnapshot: { type: String, default: null, maxlength: 1000 },
    source: { type: String, enum: ["user-edit"], default: "user-edit" },
    idempotencyKey: { type: String, required: true },
    metadata: {
        editCount: { type: Number, default: null }
    }
}, { timestamps: { createdAt: true, updatedAt: false } });

commentReplyEditAuditSchema.index({ replyStateId: 1, createdAt: -1 });
commentReplyEditAuditSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });

const CommentReplyEditAudit = mongoose.model(
    "CommentReplyEditAudit",
    commentReplyEditAuditSchema,
    "commentreplyeditaudits"
);

module.exports = CommentReplyEditAudit;
module.exports.commentReplyEditAuditActions = actionValues;
