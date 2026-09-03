const BotRun = require("../models/BotRun");
const User = require("../models/User");
const walletService = require("./billing/walletService");
const { estimateAiOperationCost } = require("./billing/costEstimator");
const userPromptService = require("./userPromptService");
const { generatePrompt } = require("../config/promptConfig");
const { conflict, notFound, forbidden, paymentRequired } = require("../utils/errors");
const { executeBotRun, executeSingleCommentReply, getVideoCommentForReply } = require("./youtubeService");

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

const getLastRunResult = (run) => {
    const results = Array.isArray(run?.results) ? run.results : [];
    return results[results.length - 1] || null;
};

const createSingleCommentReply = async ({ user, videoId, commentId, prompt, idempotencyKey }) => {
    const existing = await BotRun.findOne({ userId: user._id, idempotencyKey });
    if (existing) {
        return { run: existing, result: getLastRunResult(existing), created: false };
    }

    const existingReplyRun = await findRepliedCommentRun({ userId: user._id, videoId, commentId });
    if (existingReplyRun) {
        throw conflict("COMMENT_ALREADY_REPLIED", "This comment already has a bot reply");
    }

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
    getOwnedBotRun,
    getBotRunCreditEstimate,
    resolveBotRunPrompt
};
