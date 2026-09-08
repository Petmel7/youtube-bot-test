const { randomUUID } = require("node:crypto");
const CommentReplyState = require("../models/CommentReplyState");
const { commentPublishLockTtlMs } = require("../config/config");
const { conflict } = require("../utils/errors");

const POSTED_STATUSES = ["replied", "posted"];
const CLAIMABLE_STATUSES = ["queued", "drafted", "failed", "skipped"];

const isPostedState = (state) => Boolean(state?.youtubeReplyId) || POSTED_STATUSES.includes(state?.status);

const isFreshPublishLock = (state, now, ttlMs) => {
    if (state?.status !== "publishing" || !state.publishLockId || !state.publishLockedAt) {
        return false;
    }

    return now.getTime() - new Date(state.publishLockedAt).getTime() <= ttlMs;
};

const buildDuplicateResult = (state) => ({
    acquired: false,
    state,
    publishLockId: state?.publishLockId || null,
    completed: isPostedState(state),
    inProgress: state?.status === "publishing"
});

const isDuplicateKeyError = (error) => error?.code === 11000;

const assertExistingStateClaimable = (state, { idempotencyKey, now, ttlMs, botRunId }) => {
    if (!state) return;

    if (idempotencyKey && state.publishIdempotencyKey === idempotencyKey) {
        return;
    }

    if (isPostedState(state)) {
        throw conflict("COMMENT_ALREADY_REPLIED", "This comment already has a bot reply");
    }

    if (isFreshPublishLock(state, now, ttlMs)) {
        throw conflict("COMMENT_REPLY_PUBLISH_IN_PROGRESS", "A reply is already being published for this comment");
    }

    if (state.status === "processing" && (!botRunId || String(state.botRunId || "") !== String(botRunId))) {
        throw conflict("COMMENT_REPLY_PUBLISH_IN_PROGRESS", "A reply is already being prepared for this comment");
    }
};

const getDuplicateByPublishKey = async ({ userId, videoId, commentId, idempotencyKey }) => {
    if (!idempotencyKey) return null;

    const state = await CommentReplyState.findOne({ userId, publishIdempotencyKey: idempotencyKey });
    if (!state) return null;

    if (state.videoId !== videoId || state.commentId !== commentId) {
        throw conflict("COMMENT_PUBLISH_IDEMPOTENCY_KEY_REUSED", "Publish idempotency key was already used for another comment");
    }

    return buildDuplicateResult(state);
};

const claimCommentPublish = async ({
    userId,
    videoId,
    commentId,
    idempotencyKey,
    source,
    commentTextSnapshot = null,
    botRunId = null,
    generatedByAi,
    now = new Date(),
    ttlMs = commentPublishLockTtlMs
}) => {
    const duplicate = await getDuplicateByPublishKey({ userId, videoId, commentId, idempotencyKey });
    if (duplicate) {
        return duplicate;
    }

    const existingState = await CommentReplyState.findOne({ userId, videoId, commentId });
    assertExistingStateClaimable(existingState, { idempotencyKey, now, ttlMs, botRunId });

    const staleBefore = new Date(now.getTime() - ttlMs);
    const publishLockId = randomUUID();
    const statusClauses = [
        { status: { $exists: false } },
        { status: null },
        { status: { $in: CLAIMABLE_STATUSES } }
    ];
    if (botRunId) {
        statusClauses.push({ status: "processing", botRunId });
    }

    let state;
    try {
        state = await CommentReplyState.findOneAndUpdate({
            userId,
            videoId,
            commentId,
            $and: [
                { $or: [{ youtubeReplyId: null }, { youtubeReplyId: { $exists: false } }] },
                { $or: statusClauses },
                {
                    $or: [
                        { publishLockId: null },
                        { publishLockId: { $exists: false } },
                        { publishLockedAt: { $lte: staleBefore } }
                    ]
                }
            ]
        }, {
            $setOnInsert: {
                userId,
                videoId,
                commentId
            },
            $set: {
                status: "publishing",
                publishLockId,
                publishLockedAt: now,
                publishIdempotencyKey: idempotencyKey,
                publishSource: source,
                ...(commentTextSnapshot !== null ? { commentTextSnapshot } : {}),
                ...(botRunId ? { botRunId } : {}),
                ...(generatedByAi !== undefined ? { generatedByAi: Boolean(generatedByAi) } : {}),
                lastErrorCode: null,
                lastErrorMessage: null
            }
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
    } catch (error) {
        if (!isDuplicateKeyError(error)) {
            throw error;
        }
        const latestState = await CommentReplyState.findOne({ userId, videoId, commentId });
        if (latestState?.publishIdempotencyKey === idempotencyKey) {
            return buildDuplicateResult(latestState);
        }
        assertExistingStateClaimable(latestState, { idempotencyKey, now, ttlMs, botRunId });
        throw conflict("COMMENT_REPLY_PUBLISH_IN_PROGRESS", "A reply is already being published for this comment");
    }

    if (!state) {
        const latestState = await CommentReplyState.findOne({ userId, videoId, commentId });
        assertExistingStateClaimable(latestState, { idempotencyKey, now, ttlMs, botRunId });
        throw conflict("COMMENT_REPLY_PUBLISH_IN_PROGRESS", "A reply is already being published for this comment");
    }

    return { acquired: true, state, publishLockId };
};

const completeCommentPublish = async ({
    state,
    publishLockId,
    youtubeReplyId,
    replyTextSnapshot,
    commentTextSnapshot,
    generatedByAi,
    botRunId,
    completedAt = new Date()
}) => {
    const updatedState = await CommentReplyState.findOneAndUpdate({
        _id: state._id,
        publishLockId,
        status: "publishing"
    }, {
        $set: {
            status: "replied",
            commentTextSnapshot: commentTextSnapshot || state.commentTextSnapshot || null,
            draftReplyText: null,
            postedReplyTextSnapshot: replyTextSnapshot || null,
            youtubeReplyId,
            lastErrorCode: null,
            lastErrorMessage: null,
            generatedByAi: Boolean(generatedByAi),
            botRunId: botRunId || state.botRunId || null,
            lockedAt: null,
            completedAt
        },
        $unset: {
            publishLockId: "",
            publishLockedAt: "",
            publishSource: ""
        }
    }, { new: true });

    if (!updatedState) {
        throw conflict("COMMENT_PUBLISH_CLAIM_LOST", "Comment publish claim is no longer active");
    }

    return updatedState;
};

const failCommentPublish = async ({
    state,
    publishLockId,
    status = "failed",
    errorCode,
    errorMessage,
    commentTextSnapshot,
    draftReplyText = null,
    generatedByAi,
    completedAt = new Date()
}) => {
    if (!state?._id || !publishLockId) return state;

    return CommentReplyState.findOneAndUpdate({
        _id: state._id,
        publishLockId,
        status: "publishing"
    }, {
        $set: {
            status,
            commentTextSnapshot: commentTextSnapshot || state.commentTextSnapshot || null,
            draftReplyText,
            lastErrorCode: errorCode || null,
            lastErrorMessage: errorMessage || null,
            generatedByAi: Boolean(generatedByAi),
            lockedAt: null,
            completedAt
        },
        $unset: {
            publishLockId: "",
            publishLockedAt: "",
            publishSource: ""
        }
    }, { new: true });
};

module.exports = {
    claimCommentPublish,
    completeCommentPublish,
    failCommentPublish,
    isPostedState
};
