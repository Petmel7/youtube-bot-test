const BotRun = require("../models/BotRun");
const User = require("../models/User");
const walletService = require("./billing/walletService");
const { estimateAiOperationCost } = require("./billing/costEstimator");
const { conflict, notFound, forbidden, paymentRequired } = require("../utils/errors");
const { executeBotRun } = require("./youtubeService");

const getMinimumBotRunCredits = (prompt = "") => estimateAiOperationCost({ comment: "", prompt }).credits;

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

    const minimumCredits = getMinimumBotRunCredits(prompt);
    const availableCredits = await walletService.getAvailableCredits({ userId: user._id });
    if (availableCredits < minimumCredits) {
        throw paymentRequired("INSUFFICIENT_CREDITS", "Insufficient credits");
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

        await executeBotRun(run._id, freshUser, videoId, prompt);
    });

    return { run, created: true };
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

module.exports = { createBotRun, getOwnedBotRun };
