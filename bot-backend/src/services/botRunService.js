const BotRun = require("../models/BotRun");
const CommentReplyState = require("../models/CommentReplyState");
const User = require("../models/User");
const aiProvider = require("./ai/aiProvider");
const walletService = require("./billing/walletService");
const { estimateAiOperationCost } = require("./billing/costEstimator");
const userPromptService = require("./userPromptService");
const { generatePrompt } = require("../config/promptConfig");
const { conflict, notFound, forbidden, paymentRequired } = require("../utils/errors");
const {
    executeBotRun,
    executeSingleCommentReply,
    getVideoCommentForReply,
    replyToComment,
    createTextSnapshot
} = require("./youtubeService");

const resolveBotRunPrompt = async ({ user, fallbackPrompt = "" }) => {
    try {
        const savedPrompt = await userPromptService.getUserPromptData(user._id);
        if (savedPrompt?.channelTheme) {
            return generatePrompt(savedPrompt.channelTheme, savedPrompt.gender || "male");
        }
    } catch (error) {
        if (error.code !== "PROMPT_NOT_FOUND") {
            throw error;
        }
    }

    return fallbackPrompt;
};

const getBotRunCreditEstimate = async ({ user, prompt = "" }) => {
    const resolvedPrompt = await resolveBotRunPrompt({ user, fallbackPrompt: prompt });
    const estimate = estimateAiOperationCost({ comment: "", prompt: resolvedPrompt });
    const availableCredits = await walletService.getAvailableCredits({ userId: user._id });
    const requiredCredits = estimate.credits;

    return {
        availableCredits,
        requiredCredits,
        missingCredits: Math.max(requiredCredits - availableCredits, 0),
        estimate
    };
};

const createBotRun = async ({ user, videoId, prompt, idempotencyKey }) => {
    const existing = await BotRun.findOne({ userId: user._id, idempotencyKey });
    if (existing) {
        return { run: existing, created: false };
    }

    const activeRun = await BotRun.findOne({
        userId: user._id,
        videoId,
        status: { $in: ["queued", "running"] }
    });

    if (activeRun) {
        throw conflict("BOT_RUN_ACTIVE", "A bot run is already active for this video");
    }

    const resolvedPrompt = await resolveBotRunPrompt({ user, fallbackPrompt: prompt });
    const estimate = estimateAiOperationCost({ comment: "", prompt: resolvedPrompt });
    const availableCredits = await walletService.getAvailableCredits({ userId: user._id });
    const creditEstimate = {
        availableCredits,
        requiredCredits: estimate.credits,
        missingCredits: Math.max(estimate.credits - availableCredits, 0),
        estimate
    };
    if (creditEstimate.availableCredits < creditEstimate.requiredCredits) {
        throw paymentRequired("INSUFFICIENT_CREDITS", "Insufficient credits", creditEstimate);
    }

    let run;
    try {
        run = await BotRun.create({
            userId: user._id,
            videoId,
            idempotencyKey
        });
    } catch (error) {
        if (error.code === 11000) {
            const duplicate = await BotRun.findOne({ userId: user._id, idempotencyKey });
            if (duplicate) {
                return { run: duplicate, created: false };
            }
            throw conflict("BOT_RUN_ACTIVE", "A bot run is already active for this video");
        }
        throw error;
    }

    setImmediate(async () => {
        const freshUser = await User.findById(user._id);
        if (!freshUser) {
            await BotRun.findByIdAndUpdate(run._id, {
                status: "failed",
                errorCode: "USER_NOT_FOUND",
                errorMessage: "User not found",
                completedAt: new Date()
            });
            return;
        }

        await executeBotRun(run._id, freshUser, videoId, resolvedPrompt);
    });

    return { run, created: true };
};

const findRepliedCommentRun = async ({ userId, videoId, commentId }) => {
    return BotRun.findOne({
        userId,
        videoId,
        results: {
            $elemMatch: {
                commentId,
                status: "replied"
            }
        }
    }).sort({ updatedAt: -1 });
};

const findRepliedCommentState = async ({ userId, videoId, commentId }) => {
    return CommentReplyState.findOne({
        userId,
        videoId,
        commentId,
        status: "replied"
    });
};

const ensureCommentNotReplied = async ({ userId, videoId, commentId }) => {
    const existingState = await findRepliedCommentState({ userId, videoId, commentId });
    if (existingState) {
        throw conflict("COMMENT_ALREADY_REPLIED", "This comment already has a bot reply");
    }

    const existingReplyRun = await findRepliedCommentRun({ userId, videoId, commentId });
    if (existingReplyRun) {
        throw conflict("COMMENT_ALREADY_REPLIED", "This comment already has a bot reply");
    }
};

const getLastRunResult = (run) => {
    const results = Array.isArray(run?.results) ? run.results : [];
    return results[results.length - 1] || null;
};

const toStateResult = (state) => {
    if (!state) return null;

    return {
        commentId: state.commentId,
        status: state.status,
        runId: state.botRunId ? String(state.botRunId) : null,
        errorCode: state.lastErrorCode || null,
        errorMessage: state.lastErrorMessage || null,
        commentTextSnapshot: state.commentTextSnapshot || null,
        replyTextSnapshot: state.postedReplyTextSnapshot || null,
        draftReplyText: state.draftReplyText || null,
        youtubeReplyId: state.youtubeReplyId || null,
        generatedByAi: Boolean(state.generatedByAi),
        createdAt: state.createdAt || null,
        updatedAt: state.updatedAt || null
    };
};

const createCompletedSingleCommentRun = async ({ userId, videoId, idempotencyKey, result }) => {
    return BotRun.create({
        userId,
        videoId,
        mode: "single-comment",
        idempotencyKey,
        status: result.status === "failed" ? "failed" : "completed",
        processedCount: 1,
        successCount: result.status === "replied" ? 1 : 0,
        failureCount: result.status === "failed" ? 1 : 0,
        skippedCount: result.status === "skipped" ? 1 : 0,
        errorCode: result.status === "failed" ? result.errorCode : undefined,
        errorMessage: result.status === "failed" ? result.errorMessage : undefined,
        results: [result],
        startedAt: new Date(),
        completedAt: new Date()
    });
};

const createSingleCommentReply = async ({ user, videoId, commentId, prompt, idempotencyKey }) => {
    const existing = await BotRun.findOne({ userId: user._id, idempotencyKey });
    if (existing) {
        return { run: existing, result: getLastRunResult(existing), created: false };
    }

    await ensureCommentNotReplied({ userId: user._id, videoId, commentId });

    const resolvedPrompt = await resolveBotRunPrompt({ user, fallbackPrompt: prompt });
    const { accessToken, comment } = await getVideoCommentForReply(user, videoId, commentId);
    const estimate = estimateAiOperationCost({ comment: comment.text, prompt: resolvedPrompt });
    const availableCredits = await walletService.getAvailableCredits({ userId: user._id });
    const creditEstimate = {
        availableCredits,
        requiredCredits: estimate.credits,
        missingCredits: Math.max(estimate.credits - availableCredits, 0),
        estimate
    };
    if (creditEstimate.availableCredits < creditEstimate.requiredCredits) {
        throw paymentRequired("INSUFFICIENT_CREDITS", "Insufficient credits", creditEstimate);
    }

    let run;
    try {
        run = await BotRun.create({
            userId: user._id,
            videoId,
            mode: "single-comment",
            idempotencyKey,
            status: "running",
            startedAt: new Date()
        });
    } catch (error) {
        if (error.code === 11000) {
            const duplicate = await BotRun.findOne({ userId: user._id, idempotencyKey });
            if (duplicate) {
                return { run: duplicate, result: getLastRunResult(duplicate), created: false };
            }
        }
        throw error;
    }

    const result = await executeSingleCommentReply({
        runId: run._id,
        userId: user._id,
        videoId,
        comment,
        accessToken,
        prompt: resolvedPrompt
    });

    return { ...result, created: true };
};

const generateCommentDraft = async ({ user, videoId, commentId, prompt, idempotencyKey }) => {
    const existingState = await CommentReplyState.findOne({ userId: user._id, draftIdempotencyKey: idempotencyKey });
    if (existingState) {
        return { run: null, result: toStateResult(existingState), state: existingState, created: false };
    }

    await ensureCommentNotReplied({ userId: user._id, videoId, commentId });

    const resolvedPrompt = await resolveBotRunPrompt({ user, fallbackPrompt: prompt });
    const { comment } = await getVideoCommentForReply(user, videoId, commentId);
    const estimate = estimateAiOperationCost({ comment: comment.text, prompt: resolvedPrompt });
    const availableCredits = await walletService.getAvailableCredits({ userId: user._id });
    const creditEstimate = {
        availableCredits,
        requiredCredits: estimate.credits,
        missingCredits: Math.max(estimate.credits - availableCredits, 0),
        estimate
    };
    if (creditEstimate.availableCredits < creditEstimate.requiredCredits) {
        throw paymentRequired("INSUFFICIENT_CREDITS", "Insufficient credits", creditEstimate);
    }

    const run = await BotRun.create({
        userId: user._id,
        videoId,
        mode: "single-comment",
        idempotencyKey,
        status: "running",
        startedAt: new Date()
    });

    try {
        const aiResult = await aiProvider.generateReply({
            userId: user._id,
            runId: run._id,
            videoId,
            commentId: comment.commentId,
            comment: comment.text,
            prompt: resolvedPrompt
        });

        const result = {
            commentId: comment.commentId,
            status: "drafted",
            runId: String(run._id),
            commentTextSnapshot: createTextSnapshot(comment.text),
            draftReplyText: createTextSnapshot(aiResult.text),
            generatedByAi: true,
            aiLatencyMs: aiResult.latencyMs ?? null,
            attemptCount: aiResult.attemptCount ?? null
        };

        const state = await CommentReplyState.findOneAndUpdate({
            userId: user._id,
            videoId,
            commentId
        }, {
            $set: {
                status: "drafted",
                commentTextSnapshot: result.commentTextSnapshot,
                draftReplyText: result.draftReplyText,
                postedReplyTextSnapshot: null,
                youtubeReplyId: null,
                lastErrorCode: null,
                lastErrorMessage: null,
                generatedByAi: true,
                botRunId: run._id,
                draftIdempotencyKey: idempotencyKey
            }
        }, { new: true, upsert: true, setDefaultsOnInsert: true });

        const completedRun = await BotRun.findByIdAndUpdate(run._id, {
            status: "completed",
            processedCount: 1,
            results: [result],
            completedAt: new Date()
        }, { new: true });

        return { run: completedRun, result, state, created: true };
    } catch (error) {
        const result = {
            commentId: comment.commentId,
            status: "failed",
            runId: String(run._id),
            errorCode: error.providerErrorCode || error.code || "COMMENT_FAILED",
            errorMessage: error.isOperational ? error.message : "Failed to generate draft",
            commentTextSnapshot: createTextSnapshot(comment.text),
            aiLatencyMs: error.latencyMs ?? null,
            attemptCount: error.attemptCount ?? null
        };

        const state = await CommentReplyState.findOneAndUpdate({
            userId: user._id,
            videoId,
            commentId
        }, {
            $set: {
                status: "failed",
                commentTextSnapshot: result.commentTextSnapshot,
                lastErrorCode: result.errorCode,
                lastErrorMessage: result.errorMessage,
                generatedByAi: false,
                botRunId: run._id,
                draftIdempotencyKey: idempotencyKey
            }
        }, { new: true, upsert: true, setDefaultsOnInsert: true });

        await BotRun.findByIdAndUpdate(run._id, {
            status: "failed",
            processedCount: 1,
            failureCount: 1,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            results: [result],
            completedAt: new Date()
        });

        if (error.isOperational) {
            error.details = {
                ...(error.details || {}),
                result: toStateResult(state)
            };
        }
        throw error;
    }
};

const updateCommentDraft = async ({ user, videoId, commentId, draftReplyText }) => {
    const state = await CommentReplyState.findOneAndUpdate({
        userId: user._id,
        videoId,
        commentId,
        status: "drafted"
    }, {
        $set: {
            draftReplyText,
            lastErrorCode: null,
            lastErrorMessage: null
        }
    }, { new: true });

    if (!state) {
        throw notFound("DRAFT_NOT_FOUND", "Draft not found");
    }

    return state;
};

const publishCommentReply = async ({ user, videoId, commentId, replyText, source, idempotencyKey }) => {
    const existingPublishedState = await CommentReplyState.findOne({
        userId: user._id,
        publishIdempotencyKey: idempotencyKey
    });
    if (existingPublishedState) {
        return { run: null, result: toStateResult(existingPublishedState), state: existingPublishedState, created: false };
    }

    await ensureCommentNotReplied({ userId: user._id, videoId, commentId });

    let draftState = null;
    if (source === "draft") {
        draftState = await CommentReplyState.findOne({
            userId: user._id,
            videoId,
            commentId,
            status: "drafted"
        });
        if (!draftState) {
            throw notFound("DRAFT_NOT_FOUND", "Draft not found");
        }
    }

    const { accessToken, comment } = await getVideoCommentForReply(user, videoId, commentId);
    const responseText = replyText;

    try {
        const insertStartedAt = Date.now();
        const youtubeReplyId = await replyToComment(accessToken, commentId, responseText);
        const result = {
            commentId,
            status: "replied",
            commentTextSnapshot: createTextSnapshot(comment.text),
            replyTextSnapshot: createTextSnapshot(responseText),
            youtubeReplyId,
            generatedByAi: source === "draft" ? Boolean(draftState?.generatedByAi) : false,
            youtubeInsertLatencyMs: Date.now() - insertStartedAt
        };
        const run = await createCompletedSingleCommentRun({
            userId: user._id,
            videoId,
            idempotencyKey,
            result
        });

        const state = await CommentReplyState.findOneAndUpdate({
            userId: user._id,
            videoId,
            commentId
        }, {
            $set: {
                status: "replied",
                commentTextSnapshot: result.commentTextSnapshot,
                draftReplyText: null,
                postedReplyTextSnapshot: result.replyTextSnapshot,
                youtubeReplyId,
                lastErrorCode: null,
                lastErrorMessage: null,
                generatedByAi: result.generatedByAi,
                botRunId: run._id,
                publishIdempotencyKey: idempotencyKey
            }
        }, { new: true, upsert: true, setDefaultsOnInsert: true });

        return { run, result: { ...result, runId: String(run._id) }, state, created: true };
    } catch (error) {
        const result = {
            commentId,
            status: source === "draft" ? "drafted" : "failed",
            errorCode: error.code || "YOUTUBE_REPLY_FAILED",
            errorMessage: error.isOperational ? error.message : "Failed to publish reply",
            commentTextSnapshot: createTextSnapshot(comment.text),
            draftReplyText: source === "draft" ? replyText : null,
            generatedByAi: source === "draft" ? Boolean(draftState?.generatedByAi) : false
        };

        const state = await CommentReplyState.findOneAndUpdate({
            userId: user._id,
            videoId,
            commentId
        }, {
            $set: {
                status: result.status,
                commentTextSnapshot: result.commentTextSnapshot,
                draftReplyText: result.draftReplyText,
                lastErrorCode: result.errorCode,
                lastErrorMessage: result.errorMessage,
                generatedByAi: result.generatedByAi
            }
        }, { new: true, upsert: true, setDefaultsOnInsert: true });

        if (error.isOperational) {
            error.details = {
                ...(error.details || {}),
                result: toStateResult(state)
            };
        }
        throw error;
    }
};

const clearCommentDraft = async ({ user, videoId, commentId }) => {
    const state = await CommentReplyState.findOne({
        userId: user._id,
        videoId,
        commentId
    });

    if (!state) {
        return {
            commentId,
            status: "unanswered",
            draftReplyText: null,
            replyTextSnapshot: null,
            errorCode: null,
            errorMessage: null,
            updatedAt: new Date().toISOString()
        };
    }

    if (state.status === "replied") {
        throw conflict("COMMENT_ALREADY_REPLIED", "This comment already has a bot reply");
    }

    await CommentReplyState.deleteOne({ _id: state._id });

    return {
        commentId,
        status: "unanswered",
        draftReplyText: null,
        replyTextSnapshot: null,
        errorCode: null,
        errorMessage: null,
        updatedAt: new Date().toISOString()
    };
};

const getOwnedBotRun = async (userId, runId) => {
    const run = await BotRun.findById(runId);
    if (!run) {
        throw notFound("BOT_RUN_NOT_FOUND", "Bot run not found");
    }

    if (String(run.userId) !== String(userId)) {
        throw forbidden("BOT_RUN_FORBIDDEN", "Bot run does not belong to this user");
    }

    return run;
};

module.exports = {
    createBotRun,
    createSingleCommentReply,
    generateCommentDraft,
    updateCommentDraft,
    publishCommentReply,
    clearCommentDraft,
    getOwnedBotRun,
    getBotRunCreditEstimate,
    resolveBotRunPrompt
};
