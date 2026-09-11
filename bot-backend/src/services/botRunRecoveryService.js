const BotRun = require("../models/BotRun");
const CommentReplyState = require("../models/CommentReplyState");
const User = require("../models/User");
const {
    botRunRecoveryBatchSize,
    botRunRecoveryIntervalMs,
    botRunStaleLockMs
} = require("../config/config");
const { generatePrompt } = require("../config/promptConfig");
const userPromptService = require("./userPromptService");
const { executeBotRun } = require("./youtubeService");

const RECOVERED_ERROR_CODE = "BOT_RUN_STALE_LOCK_RECOVERED";
const RECOVERED_FAILED_CODE = "BOT_RUN_RECOVERED_FAILED";
const PUBLISH_RECOVERED_CODE = "COMMENT_PUBLISH_STALE_LOCK_RECOVERED";
const STACK_LOG_APP_ENVS = new Set(["development", "test", "local"]);

let recoveryInProgress = false;

const redactSensitiveLogText = (value) => {
    if (typeof value !== "string") return value;
    return value
        .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
        .replace(/\b(access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|secret|password)\b\s*[:=]\s*[^,\s}\]]+/gi, "$1=[REDACTED]");
};

const trimLogText = (value, maxLength = 1000) => {
    if (typeof value !== "string") return value;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
};

const resolveRuntimeAppEnv = () => {
    if (process.env.APP_ENV) return process.env.APP_ENV;
    if (process.env.NODE_ENV === "production") return "production";
    return process.env.NODE_ENV || "development";
};

const shouldIncludeRecoveryStack = (appEnv = resolveRuntimeAppEnv()) => STACK_LOG_APP_ENVS.has(appEnv);

const toSafeRecoveryErrorLog = (
    error,
    fallbackCode = "BOT_RUN_RECOVERY_FAILED",
    { appEnv = resolveRuntimeAppEnv() } = {}
) => {
    const safeDetails = {
        code: redactSensitiveLogText(error?.code || fallbackCode),
        name: redactSensitiveLogText(error?.name || "Error"),
        message: trimLogText(redactSensitiveLogText(error?.message || "Unknown recovery error"))
    };

    if (shouldIncludeRecoveryStack(appEnv) && error?.stack) {
        safeDetails.stack = trimLogText(redactSensitiveLogText(error.stack), 4000);
    }

    return safeDetails;
};

const isOlderThan = (value, staleBefore) => !value || new Date(value).getTime() <= staleBefore.getTime();

const createStaleRunQuery = (staleBefore) => ({
    mode: "bulk",
    status: { $in: ["queued", "running"] },
    $or: [
        { updatedAt: { $lte: staleBefore } },
        { startedAt: { $lte: staleBefore } },
        { createdAt: { $lte: staleBefore } }
    ]
});

const loadStaleRuns = async ({ staleBefore, batchSize }) => {
    const query = BotRun.find(createStaleRunQuery(staleBefore)).sort({ updatedAt: 1, createdAt: 1 });
    if (typeof query.limit === "function") {
        return query.limit(batchSize);
    }
    return query;
};

const resolveRunPrompt = async (user) => {
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
    return "";
};

const summarizeTasks = (tasks) => tasks.reduce((summary, task) => {
    if (task.status === "queued") summary.queuedCount++;
    if (task.status === "processing" || task.status === "publishing") summary.processingCount++;
    if (task.status === "replied" || task.status === "posted") summary.successCount++;
    if (task.status === "failed") summary.failureCount++;
    if (task.status === "skipped") summary.skippedCount++;
    if (["replied", "posted", "failed", "skipped", "drafted"].includes(task.status)) summary.processedCount++;
    return summary;
}, {
    queuedCount: 0,
    processingCount: 0,
    processedCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0
});

const taskToResult = (task) => ({
    taskId: String(task._id || task.id),
    commentId: task.commentId,
    status: task.status === "posted" ? "replied" : (task.status === "publishing" ? "processing" : task.status),
    runId: task.botRunId ? String(task.botRunId) : null,
    errorCode: task.lastErrorCode || null,
    errorMessage: task.lastErrorMessage || null,
    commentTextSnapshot: task.commentTextSnapshot || null,
    replyTextSnapshot: task.postedReplyTextSnapshot || null,
    draftReplyText: task.draftReplyText || null,
    youtubeReplyId: task.youtubeReplyId || null,
    generatedByAi: Boolean(task.generatedByAi),
    attemptCount: task.attempts ?? 0,
    updatedAt: task.updatedAt || null
});

const updateTaskForRecovery = async (task, staleBefore) => {
    if (task.youtubeReplyId || task.status === "replied" || task.status === "posted") {
        return "posted";
    }

    if (task.status === "processing") {
        if (!isOlderThan(task.lockedAt || task.updatedAt, staleBefore)) {
            return "active";
        }
        task.status = "queued";
        task.lockedAt = null;
        task.completedAt = null;
        task.lastErrorCode = null;
        task.lastErrorMessage = null;
        await task.save();
        return "requeued";
    }

    if (task.status === "publishing") {
        if (!isOlderThan(task.publishLockedAt || task.updatedAt, staleBefore)) {
            return "active";
        }
        task.status = "failed";
        task.lockedAt = null;
        task.publishLockId = null;
        task.publishLockedAt = null;
        task.publishSource = null;
        task.completedAt = new Date();
        task.lastErrorCode = PUBLISH_RECOVERED_CODE;
        task.lastErrorMessage = "Publishing was interrupted before completion; retry is required";
        await task.save();
        return "failed";
    }

    if (task.status === "queued") {
        task.lockedAt = null;
        task.completedAt = null;
        await task.save();
        return "queued";
    }

    return "unchanged";
};

const updateRecoveredRun = async ({ run, tasks, recoveredTaskKinds, scheduleResume }) => {
    const counts = summarizeTasks(tasks);
    const shouldResume = recoveredTaskKinds.requeued > 0 || counts.queuedCount > 0;
    const hasActiveWork = shouldResume || counts.processingCount > 0;
    const status = hasActiveWork
        ? (counts.processingCount > 0 ? "running" : "queued")
        : counts.failureCount > 0
            ? (counts.successCount > 0 || counts.skippedCount > 0 ? "partial" : "failed")
            : "completed";

    const update = {
        status,
        processedCount: counts.processedCount,
        successCount: counts.successCount,
        failureCount: counts.failureCount,
        skippedCount: counts.skippedCount,
        results: tasks.map(taskToResult),
        errorCode: status === "queued" ? RECOVERED_ERROR_CODE : (status === "failed" || status === "partial" ? RECOVERED_FAILED_CODE : undefined),
        errorMessage: status === "queued"
            ? "Bot run was recovered after interruption and queued to resume"
            : ((status === "failed" || status === "partial") ? "Bot run was stopped after interruption" : undefined),
        ...(status === "queued" ? { completedAt: null } : { completedAt: new Date() })
    };

    await BotRun.findByIdAndUpdate(run._id, update);

    if (scheduleResume && shouldResume) {
        scheduleResume(run);
    }

    return status;
};

const recoverBotRun = async ({ run, staleBefore, scheduleResume }) => {
    const tasks = await CommentReplyState.find({
        userId: run.userId,
        botRunId: run._id,
        taskType: "bulk-reply"
    }).sort({ createdAt: 1 });

    const recoveredTaskKinds = {
        requeued: 0,
        failed: 0,
        queued: 0,
        active: 0,
        posted: 0,
        unchanged: 0
    };

    for (const task of tasks) {
        const outcome = await updateTaskForRecovery(task, staleBefore);
        recoveredTaskKinds[outcome] = (recoveredTaskKinds[outcome] || 0) + 1;
    }

    if (tasks.length === 0) {
        await BotRun.findByIdAndUpdate(run._id, {
            status: "failed",
            errorCode: RECOVERED_FAILED_CODE,
            errorMessage: "Bot run was interrupted before tasks were created",
            completedAt: new Date()
        });
        return { status: "failed", tasks };
    }

    const status = await updateRecoveredRun({ run, tasks, recoveredTaskKinds, scheduleResume });
    return { status, tasks, recoveredTaskKinds };
};

const resumeRecoveredRun = (run, { logger = console, scheduler = setImmediate } = {}) => {
    scheduler(async () => {
        try {
            const freshUser = await User.findById(run.userId);
            if (!freshUser) {
                await BotRun.findByIdAndUpdate(run._id, {
                    status: "failed",
                    errorCode: "USER_NOT_FOUND",
                    errorMessage: "User not found",
                    completedAt: new Date()
                });
                return;
            }

            const prompt = await resolveRunPrompt(freshUser);
            await executeBotRun(run._id, freshUser, run.videoId, prompt);
        } catch (error) {
            logger.error("Bot run recovery resume failed", {
                runId: String(run._id),
                ...toSafeRecoveryErrorLog(error, "BOT_RUN_RECOVERY_RESUME_FAILED")
            });
            await BotRun.findByIdAndUpdate(run._id, {
                status: "failed",
                errorCode: error.code || "BOT_RUN_RECOVERY_RESUME_FAILED",
                errorMessage: error.isOperational ? error.message : "Recovered bot run failed to resume",
                completedAt: new Date()
            });
        }
    });
};

const recoverStaleBotRuns = async ({
    now = new Date(),
    staleLockMs = botRunStaleLockMs,
    batchSize = botRunRecoveryBatchSize,
    executeRecoveredRuns = true,
    scheduler = setImmediate,
    logger = console
} = {}) => {
    const staleBefore = new Date(now.getTime() - staleLockMs);
    const staleRuns = await loadStaleRuns({ staleBefore, batchSize });
    const summary = {
        runsScanned: staleRuns.length,
        runsRecovered: 0,
        runsFailed: 0,
        tasksRequeued: 0,
        tasksFailed: 0
    };

    for (const run of staleRuns) {
        const result = await recoverBotRun({
            run,
            staleBefore,
            scheduleResume: executeRecoveredRuns
                ? (recoveredRun) => resumeRecoveredRun(recoveredRun, { logger, scheduler })
                : null
        });
        if (result.status === "queued") summary.runsRecovered++;
        if (["failed", "partial"].includes(result.status)) summary.runsFailed++;
        summary.tasksRequeued += result.recoveredTaskKinds?.requeued || 0;
        summary.tasksFailed += result.recoveredTaskKinds?.failed || 0;
    }

    return summary;
};

const runBotRunRecoveryOnce = async (options = {}) => {
    if (recoveryInProgress) {
        return { skipped: true, reason: "RECOVERY_IN_PROGRESS" };
    }

    recoveryInProgress = true;
    try {
        return await recoverStaleBotRuns(options);
    } finally {
        recoveryInProgress = false;
    }
};

const startBotRunRecoveryLoop = ({ intervalMs = botRunRecoveryIntervalMs, logger = console } = {}) => {
    let stopped = false;
    const timer = setInterval(async () => {
        if (stopped) return;
        try {
            const summary = await runBotRunRecoveryOnce({ logger });
            if (!summary.skipped && summary.runsScanned > 0) {
                logger.info("Bot run recovery completed", summary);
            }
        } catch (error) {
            logger.error("Bot run recovery failed", toSafeRecoveryErrorLog(error, "BOT_RUN_RECOVERY_FAILED"));
        }
    }, intervalMs);

    if (typeof timer.unref === "function") {
        timer.unref();
    }

    return () => {
        stopped = true;
        clearInterval(timer);
    };
};

module.exports = {
    RECOVERED_ERROR_CODE,
    RECOVERED_FAILED_CODE,
    PUBLISH_RECOVERED_CODE,
    recoverStaleBotRuns,
    runBotRunRecoveryOnce,
    startBotRunRecoveryLoop,
    resumeRecoveredRun,
    shouldIncludeRecoveryStack,
    toSafeRecoveryErrorLog
};
