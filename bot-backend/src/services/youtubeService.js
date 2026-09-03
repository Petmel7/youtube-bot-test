const { google } = require("googleapis");
const BotRun = require("../models/BotRun");
const CommentReplyState = require("../models/CommentReplyState");
const VideoCatalog = require("../models/VideoCatalog");
const { getValidAccessToken } = require("./authService");
const aiProvider = require("./ai/aiProvider");
const {
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    youtubeApiBase,
    botMaxCommentsPerRun,
    botMaxPagesPerRun,
    geminiRequestSpacingMs
} = require("../config/config");
const { forbidden, notFound, unprocessable, upstream } = require("../utils/errors");

const VIDEO_CATALOG_SYNC_PAGE_SIZE = 50;
const VIDEO_CATALOG_SYNC_MAX_PAGES = 6;
const BOT_RUN_TEXT_SNAPSHOT_MAX_LENGTH = 1000;
const COMMENT_RESULT_STATUS_PRIORITY = {
    processing: 2,
    queued: 1,
    drafted: 2,
    replied: 3,
    posted: 3,
    failed: 2,
    skipped: 1
};

const createTextSnapshot = (value) => {
    if (typeof value !== "string") return null;

    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return null;

    return normalized.length > BOT_RUN_TEXT_SNAPSHOT_MAX_LENGTH
        ? normalized.slice(0, BOT_RUN_TEXT_SNAPSHOT_MAX_LENGTH)
        : normalized;
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getTopLevelComment = (item) => ({
    commentId: item?.snippet?.topLevelComment?.id,
    commentText: item?.snippet?.topLevelComment?.snippet?.textOriginal
});

const createYoutubeClient = async (user) => {
    const accessToken = await getValidAccessToken(user);
    const authClient = new google.auth.OAuth2(googleClientId, googleClientSecret, googleRedirectUri);
    authClient.setCredentials({ access_token: accessToken });

    return { youtube: google.youtube({ version: "v3", auth: authClient }), accessToken };
};

const markRunFailed = async (runId, error) => {
    await BotRun.findByIdAndUpdate(runId, {
        status: "failed",
        errorCode: error.code || "BOT_RUN_FAILED",
        errorMessage: error.isOperational ? error.message : "Bot run failed",
        completedAt: new Date()
    });
};

const addRunResult = async (runId, result) => {
    const update = {
        $inc: {
            processedCount: 1,
            successCount: result.status === "replied" ? 1 : 0,
            failureCount: result.status === "failed" ? 1 : 0,
            skippedCount: result.status === "skipped" ? 1 : 0
        },
        $push: { results: result }
    };

    await BotRun.findByIdAndUpdate(runId, update);
};

const shouldStopRunAfterAiError = (errorCode) => [
    "GEMINI_RATE_LIMIT",
    "GEMINI_AUTH_FAILED",
    "GEMINI_INVALID_MODEL"
].includes(errorCode);

const getProviderLimitMessage = (errorCode) => {
    if (errorCode === "GEMINI_RATE_LIMIT") {
        return "AI provider rate limit reached";
    }

    if (errorCode === "GEMINI_AUTH_FAILED" || errorCode === "GEMINI_INVALID_MODEL") {
        return "AI provider configuration prevents this run from continuing";
    }

    return "AI provider limit reached";
};

const skipRemainingForProviderLimit = async ({ runId, items, startIndex, maxResults, processed, errorCode }) => {
    let skipped = 0;
    const errorMessage = getProviderLimitMessage(errorCode);

    for (let index = startIndex; index < items.length && processed + skipped < maxResults; index++) {
        const { commentId, commentText } = getTopLevelComment(items[index]);

        await addRunResult(runId, {
            commentId: commentId || "unknown",
            status: "skipped",
            errorCode,
            errorMessage,
            commentTextSnapshot: createTextSnapshot(commentText)
        });
        skipped++;
    }

    return skipped;
};

const hasPreviouslyReplied = async (userId, videoId, commentId) => {
    const stateReply = await CommentReplyState.exists({
        userId,
        videoId,
        commentId,
        status: "replied"
    });
    if (stateReply) return true;

    return BotRun.exists({
        userId,
        videoId,
        results: {
            $elemMatch: {
                commentId,
                status: "replied"
            }
        }
    });
};

const updateCommentReplyStateFromResult = async ({ userId, videoId, result, youtubeReplyId = null }) => {
    if (!result?.commentId) return null;

    if (result.status === "replied") {
        return CommentReplyState.findOneAndUpdate({
            userId,
            videoId,
            commentId: result.commentId
        }, {
            $set: {
                status: "replied",
                commentTextSnapshot: result.commentTextSnapshot || null,
                draftReplyText: null,
                postedReplyTextSnapshot: result.replyTextSnapshot || null,
                youtubeReplyId,
                lastErrorCode: null,
                lastErrorMessage: null,
                generatedByAi: true,
                botRunId: result.runId || null
            }
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
    }

    if (result.status === "failed") {
        return CommentReplyState.findOneAndUpdate({
            userId,
            videoId,
            commentId: result.commentId
        }, {
            $set: {
                status: "failed",
                commentTextSnapshot: result.commentTextSnapshot || null,
                lastErrorCode: result.errorCode || null,
                lastErrorMessage: result.errorMessage || null,
                generatedByAi: false,
                botRunId: result.runId || null
            }
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
    }

    return null;
};

const getRunTasks = async (runId) => CommentReplyState.find({
    botRunId: runId,
    taskType: "bulk-reply"
}).sort({ createdAt: 1 });

const syncRunCountersFromTasks = async (runId, extra = {}) => {
    const tasks = await getRunTasks(runId);
    const counts = tasks.reduce((summary, task) => {
        if (task.status === "queued") summary.queuedCount++;
        if (task.status === "processing") summary.processingCount++;
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

    const status = counts.processingCount > 0 || counts.queuedCount > 0
        ? "running"
        : counts.failureCount > 0
            ? (counts.successCount > 0 || counts.skippedCount > 0 ? "partial" : "failed")
            : "completed";

    return BotRun.findByIdAndUpdate(runId, {
        status,
        processedCount: counts.processedCount,
        successCount: counts.successCount,
        failureCount: counts.failureCount,
        skippedCount: counts.skippedCount,
        ...(status === "running" ? {} : { completedAt: new Date() }),
        ...extra
    }, { new: true });
};

const createBulkReplyTasks = async (user, videoId, runId) => {
    await verifyVideoOwnership(user, videoId);

    const { youtube } = await createYoutubeClient(user);
    let nextPageToken = null;
    let pageCount = 0;
    let scanned = 0;
    let created = 0;
    let skipped = 0;

    do {
        pageCount++;
        const response = await youtube.commentThreads.list({
            part: "snippet",
            videoId,
            maxResults: Math.min(100, botMaxCommentsPerRun),
            pageToken: nextPageToken || undefined,
            order: "time"
        });

        for (const item of response.data.items || []) {
            if (scanned >= botMaxCommentsPerRun) break;
            scanned++;

            const { commentId, commentText } = getTopLevelComment(item);
            if (!commentId || !commentText) {
                skipped++;
                continue;
            }

            if (await hasPreviouslyReplied(user._id, videoId, commentId)) {
                skipped++;
                continue;
            }

            const result = await CommentReplyState.updateOne({
                userId: user._id,
                videoId,
                commentId,
                status: { $ne: "replied" }
            }, {
                $setOnInsert: {
                    userId: user._id,
                    videoId,
                    commentId,
                    taskType: "bulk-reply",
                    status: "queued",
                    botRunId: runId,
                    attempts: 0,
                    idempotencyKey: `${runId}:${commentId}`
                },
                $set: {
                    commentTextSnapshot: createTextSnapshot(commentText),
                    lastErrorCode: null,
                    lastErrorMessage: null
                }
            }, { upsert: true });

            if (result.upsertedCount || result.modifiedCount) {
                created++;
            }
        }

        nextPageToken = scanned < botMaxCommentsPerRun
            ? response.data.nextPageToken || null
            : null;
    } while (nextPageToken && pageCount < botMaxPagesPerRun);

    const tasks = await getRunTasks(runId);
    await BotRun.findByIdAndUpdate(runId, {
        processedCount: 0,
        successCount: 0,
        failureCount: 0,
        skippedCount: 0,
        results: tasks.map(task => ({
            commentId: task.commentId,
            status: task.status,
            runId: String(runId),
            commentTextSnapshot: task.commentTextSnapshot,
            attemptCount: task.attempts ?? 0,
            updatedAt: task.updatedAt
        }))
    });

    if (tasks.length === 0) {
        await BotRun.findByIdAndUpdate(runId, {
            status: "completed",
            completedAt: new Date()
        });
    }

    return { created, skipped, total: tasks.length };
};

const taskToResult = (task) => ({
    taskId: String(task._id || task.id),
    commentId: task.commentId,
    status: task.status === "posted" ? "replied" : task.status,
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

const refreshRunResultsFromTasks = async (runId, extra = {}) => {
    const tasks = await getRunTasks(runId);
    const run = await syncRunCountersFromTasks(runId, {
        results: tasks.map(taskToResult),
        ...extra
    });
    return run;
};

const processQueuedBotRunTasks = async ({ runId, user, videoId, userPrompt, accessToken, requestSpacingMs, sleepFn }) => {
    const tasks = await getRunTasks(runId);
    if (tasks.length === 0) {
        return false;
    }

    let geminiRequestCount = 0;
    let stopForProviderLimit = false;
    let providerLimitErrorCode = null;

    for (const task of tasks) {
        if (stopForProviderLimit) {
            if (["queued", "processing"].includes(task.status)) {
                task.status = "skipped";
                task.lastErrorCode = providerLimitErrorCode;
                task.lastErrorMessage = getProviderLimitMessage(providerLimitErrorCode);
                task.completedAt = new Date();
                await task.save();
            }
            continue;
        }

        if (task.status !== "queued") {
            continue;
        }

        task.status = "processing";
        task.lockedAt = new Date();
        task.attempts = (task.attempts || 0) + 1;
        await task.save();
        await refreshRunResultsFromTasks(runId);

        try {
            if (geminiRequestCount > 0 && requestSpacingMs > 0) {
                await sleepFn(requestSpacingMs);
            }
            geminiRequestCount++;
            const response = await aiProvider.generateReply({
                userId: user._id,
                runId,
                videoId,
                commentId: task.commentId,
                comment: task.commentTextSnapshot,
                prompt: userPrompt,
                deferBilling: true
            });

            const insertStartedAt = Date.now();
            let youtubeReplyId;
            try {
                youtubeReplyId = await replyToComment(accessToken, task.commentId, response.text);
                await response.finalizeBilling();
            } catch (error) {
                if (response.releaseBilling && error.code === "YOUTUBE_REPLY_FAILED") {
                    await response.releaseBilling("youtube-reply-failed");
                }
                throw error;
            }

            task.status = "replied";
            task.postedReplyTextSnapshot = createTextSnapshot(response.text);
            task.youtubeReplyId = youtubeReplyId;
            task.generatedByAi = true;
            task.lastErrorCode = null;
            task.lastErrorMessage = null;
            task.completedAt = new Date();
            task.lockedAt = null;
            await task.save();
        } catch (error) {
            const errorCode = error.providerErrorCode || error.code || "COMMENT_FAILED";
            task.status = "failed";
            task.lastErrorCode = errorCode;
            task.lastErrorMessage = error.isOperational ? error.message : "Failed to process comment";
            task.lockedAt = null;
            task.completedAt = new Date();
            await task.save();

            if (shouldStopRunAfterAiError(errorCode)) {
                stopForProviderLimit = true;
                providerLimitErrorCode = errorCode;
            }
        }
    }

    await refreshRunResultsFromTasks(runId, {
        errorCode: providerLimitErrorCode || undefined,
        errorMessage: providerLimitErrorCode ? getProviderLimitMessage(providerLimitErrorCode) : undefined
    });
    return true;
};

const verifyVideoOwnership = async (user, videoId) => {
    const { youtube } = await createYoutubeClient(user);
    const channelId = await getUserChannelId(user);
    const response = await youtube.videos.list({
        part: "snippet",
        id: videoId
    });

    const video = response.data.items?.[0];
    if (!video) {
        throw notFound("VIDEO_NOT_FOUND", "Video not found");
    }

    if (video.snippet?.channelId !== channelId) {
        throw forbidden("VIDEO_FORBIDDEN", "Video does not belong to the authenticated channel");
    }
};

async function executeBotRun(runId, user, videoId, userPrompt, {
    requestSpacingMs = geminiRequestSpacingMs,
    sleepFn = sleep
} = {}) {
    const run = await BotRun.findById(runId);
    if (!run || run.status !== "queued") {
        return;
    }

    await BotRun.findByIdAndUpdate(runId, { status: "running", startedAt: new Date() });

    try {
        await verifyVideoOwnership(user, videoId);

        const { youtube, accessToken } = await createYoutubeClient(user);
        const processedQueuedTasks = await processQueuedBotRunTasks({
            runId,
            user,
            videoId,
            userPrompt,
            accessToken,
            requestSpacingMs,
            sleepFn
        });
        if (processedQueuedTasks) {
            return;
        }

        let nextPageToken = null;
        let pageCount = 0;
        let processed = 0;
        let stopForProviderLimit = false;
        let providerLimitErrorCode = null;
        let geminiRequestCount = 0;

        do {
            pageCount++;
            const response = await youtube.commentThreads.list({
                part: "snippet",
                videoId,
                maxResults: Math.min(100, botMaxCommentsPerRun),
                pageToken: nextPageToken || undefined
            });

            const items = response.data.items || [];
            for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
                const item = items[itemIndex];
                if (processed >= botMaxCommentsPerRun) break;

                const { commentId, commentText } = getTopLevelComment(item);
                if (!commentId || !commentText) {
                    await addRunResult(runId, {
                        commentId: commentId || "unknown",
                        status: "skipped",
                        errorCode: "INVALID_COMMENT",
                        errorMessage: "Comment data was incomplete",
                        commentTextSnapshot: createTextSnapshot(commentText)
                    });
                    processed++;
                    continue;
                }

                if (await hasPreviouslyReplied(user._id, videoId, commentId)) {
                    await addRunResult(runId, {
                        commentId,
                        status: "skipped",
                        commentTextSnapshot: createTextSnapshot(commentText)
                    });
                    processed++;
                    continue;
                }

                try {
                    if (geminiRequestCount > 0 && requestSpacingMs > 0) {
                        await sleepFn(requestSpacingMs);
                    }
                    geminiRequestCount++;
                    const response = await aiProvider.generateReply({
                        userId: user._id,
                        runId,
                        videoId,
                        commentId,
                        comment: commentText,
                        prompt: userPrompt
                    });
                    const responseText = response.text;
                    const insertStartedAt = Date.now();
                    const youtubeReplyId = await replyToComment(accessToken, commentId, responseText);
                    const result = {
                        commentId,
                        status: "replied",
                        runId: String(runId),
                        commentTextSnapshot: createTextSnapshot(commentText),
                        replyTextSnapshot: createTextSnapshot(responseText),
                        aiLatencyMs: response.latencyMs ?? null,
                        youtubeInsertLatencyMs: Date.now() - insertStartedAt,
                        attemptCount: response.attemptCount ?? null
                    };
                    await addRunResult(runId, result);
                    await updateCommentReplyStateFromResult({ userId: user._id, videoId, result, youtubeReplyId });
                } catch (error) {
                    const errorCode = error.providerErrorCode || error.code || "COMMENT_FAILED";
                    const result = {
                        commentId,
                        status: "failed",
                        runId: String(runId),
                        errorCode,
                        errorMessage: error.isOperational ? error.message : "Failed to process comment",
                        commentTextSnapshot: createTextSnapshot(commentText),
                        aiLatencyMs: error.latencyMs ?? null,
                        attemptCount: error.attemptCount ?? null
                    };
                    await addRunResult(runId, result);
                    await updateCommentReplyStateFromResult({ userId: user._id, videoId, result });
                    if (shouldStopRunAfterAiError(errorCode)) {
                        stopForProviderLimit = true;
                        providerLimitErrorCode = errorCode;
                        processed += await skipRemainingForProviderLimit({
                            runId,
                            items,
                            startIndex: itemIndex + 1,
                            maxResults: botMaxCommentsPerRun,
                            processed: processed + 1,
                            errorCode
                        });
                    }
                }

                processed++;
                if (stopForProviderLimit) break;
            }

            nextPageToken = !stopForProviderLimit && processed < botMaxCommentsPerRun
                ? response.data.nextPageToken || null
                : null;
        } while (!stopForProviderLimit && nextPageToken && pageCount < botMaxPagesPerRun);

        const completedRun = await BotRun.findById(runId);
        const status = completedRun.failureCount > 0
            ? (completedRun.successCount > 0 || completedRun.skippedCount > 0 ? "partial" : "failed")
            : "completed";

        await BotRun.findByIdAndUpdate(runId, {
            status,
            completedAt: new Date(),
            errorCode: providerLimitErrorCode || (status === "failed" ? "BOT_RUN_NO_REPLIES" : undefined),
            errorMessage: providerLimitErrorCode
                ? getProviderLimitMessage(providerLimitErrorCode)
                : (status === "failed" ? "Bot run did not create any replies" : undefined)
        });
    } catch (error) {
        await markRunFailed(runId, error);
    }
}

async function replyToComment(accessToken, commentId, responseText) {
    if (!responseText) {
        throw upstream("EMPTY_REPLY", "Reply text is empty");
    }

    const authClient = new google.auth.OAuth2(googleClientId, googleClientSecret, googleRedirectUri);
    authClient.setCredentials({ access_token: accessToken });
    const youtube = google.youtube({ version: "v3", auth: authClient });

    try {
        const response = await youtube.comments.insert({
            part: "snippet",
            resource: {
                snippet: {
                    parentId: commentId,
                    textOriginal: responseText
                }
            }
        });
        return response.data?.id || null;
    } catch (error) {
        throw upstream("YOUTUBE_REPLY_FAILED", "Failed to reply to YouTube comment");
    }
}

const getUserChannelInfo = async (user) => {
    const accessToken = await getValidAccessToken(user);
    const params = new URLSearchParams({
        part: "contentDetails",
        mine: "true"
    });

    const res = await fetch(`${youtubeApiBase}/channels?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
        await throwYoutubeUpstream(res, "channels", "YOUTUBE_CHANNEL_FAILED", "Failed to fetch channel details");
    }
    const data = await res.json();
    const channel = data.items?.[0];

    if (!channel?.id) throw notFound("YOUTUBE_CHANNEL_NOT_FOUND", "No channels found for user");

    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
        throw notFound("YOUTUBE_UPLOADS_PLAYLIST_NOT_FOUND", "No uploads playlist found for user");
    }

    return {
        channelId: channel.id,
        uploadsPlaylistId
    };
};

const getUserChannelId = async (user) => {
    const { channelId } = await getUserChannelInfo(user);
    return channelId;
};

const normalizeCatalogText = (value = "") => String(value)
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase();

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const encodeCatalogCursor = (video) => {
    const payload = JSON.stringify({
        publishedAt: video.publishedAt ? new Date(video.publishedAt).toISOString() : null,
        id: String(video._id)
    });

    return Buffer.from(payload).toString("base64url");
};

const decodeCatalogCursor = (cursor) => {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (!parsed?.id || !/^[a-f0-9]{24}$/i.test(parsed.id)) {
            throw new Error("Invalid cursor id");
        }

        const publishedAt = parsed.publishedAt ? new Date(parsed.publishedAt) : null;
        if (parsed.publishedAt && Number.isNaN(publishedAt.getTime())) {
            throw new Error("Invalid cursor date");
        }

        return { publishedAt, id: parsed.id };
    } catch (error) {
        throw unprocessable("INVALID_PAGE_TOKEN", "Invalid page token");
    }
};

const toVideoDto = (video) => ({
    videoId: video.videoId,
    title: video.title || "",
    description: video.description || "",
    publishedAt: video.publishedAt ? new Date(video.publishedAt).toISOString() : null,
    thumbnail: video.thumbnail || null,
    duration: video.duration || null,
    views: video.views || null,
    likes: video.likes || null,
    comments: video.comments || null
});

const createCatalogUpdate = ({ userId, channelId, video, syncedAt }) => ({
    updateOne: {
        filter: { userId, videoId: video.videoId },
        update: {
            $set: {
                userId,
                channelId,
                videoId: video.videoId,
                title: video.title,
                description: video.description,
                normalizedTitle: normalizeCatalogText(video.title),
                normalizedDescription: normalizeCatalogText(video.description),
                publishedAt: video.publishedAt ? new Date(video.publishedAt) : null,
                thumbnail: video.thumbnail,
                duration: video.duration,
                views: video.views,
                likes: video.likes,
                comments: video.comments,
                privacyStatus: video.privacyStatus || null,
                uploadStatus: video.uploadStatus || null,
                lastSyncedAt: syncedAt
            }
        },
        upsert: true
    }
});

const readYoutubeErrorInfo = async (res) => {
    try {
        const body = await res.json();
        const error = body?.error || {};
        const reason = error.errors?.[0]?.reason || error.status || null;

        return {
            status: res.status || null,
            providerCode: error.code || res.status || null,
            reason
        };
    } catch (error) {
        return {
            status: res.status || null,
            providerCode: res.status || null,
            reason: null
        };
    }
};

const isYoutubeQuotaFailure = (info) => {
    const reason = String(info.reason || "").toLowerCase();
    return reason.includes("quota") || reason.includes("ratelimit") || reason.includes("ratelimitexceeded");
};

const isYoutubeAuthFailure = (info) => {
    const reason = String(info.reason || "").toLowerCase();
    return info.status === 401
        || reason.includes("auth")
        || reason.includes("credential")
        || reason.includes("unauthorized");
};

const throwYoutubeUpstream = async (res, endpointKind, code, message) => {
    const info = await readYoutubeErrorInfo(res);
    console.warn("YouTube upstream request failed", {
        endpointKind,
        status: info.status,
        providerCode: info.providerCode,
        reason: info.reason
    });

    if (isYoutubeAuthFailure(info)) {
        throw upstream("YOUTUBE_AUTH_FAILED", "Reconnect YouTube and try again");
    }

    if (isYoutubeQuotaFailure(info)) {
        throw upstream("YOUTUBE_QUOTA_EXCEEDED", "YouTube API quota exceeded. Try again later.");
    }

    throw upstream(code, message);
};

const readYoutubeClientErrorInfo = (error) => {
    const providerError = error?.errors?.[0] || error?.response?.data?.error?.errors?.[0] || {};
    const responseError = error?.response?.data?.error || {};

    return {
        status: error?.code || error?.status || error?.response?.status || null,
        providerCode: responseError.code || error?.code || error?.status || null,
        reason: providerError.reason || responseError.status || null
    };
};

const throwYoutubeClientError = (error, endpointKind, code, message) => {
    const info = readYoutubeClientErrorInfo(error);
    console.warn("YouTube upstream request failed", {
        endpointKind,
        status: info.status,
        providerCode: info.providerCode,
        reason: info.reason
    });

    if (isYoutubeAuthFailure(info)) {
        throw upstream("YOUTUBE_AUTH_FAILED", "Reconnect YouTube and try again");
    }

    if (isYoutubeQuotaFailure(info)) {
        throw upstream("YOUTUBE_QUOTA_EXCEEDED", "YouTube API quota exceeded. Try again later.");
    }

    throw upstream(code, message);
};

const fetchVideoDetails = async (accessToken, orderedVideoIds) => {
    if (orderedVideoIds.length === 0) {
        return [];
    }

    const videoIds = orderedVideoIds.join(",");
    const detailsRes = await fetch(`${youtubeApiBase}/videos?part=snippet,contentDetails,statistics,status&id=${videoIds}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!detailsRes.ok) {
        await throwYoutubeUpstream(detailsRes, "videos", "YOUTUBE_VIDEO_DETAILS_FAILED", "Failed to fetch video details");
    }
    const detailsData = await detailsRes.json();

    const videosById = new Map((detailsData.items || []).map(video => [video.id, {
            videoId: video.id,
            title: video.snippet?.title || "",
            description: video.snippet?.description || "",
            publishedAt: video.snippet?.publishedAt || null,
            thumbnail: video.snippet?.thumbnails?.medium?.url || null,
            duration: video.contentDetails?.duration || null,
            views: video.statistics?.viewCount || null,
            likes: video.statistics?.likeCount || null,
            comments: video.statistics?.commentCount || null,
            privacyStatus: video.status?.privacyStatus || null,
            uploadStatus: video.status?.uploadStatus || null
        }]));

    return orderedVideoIds.map(videoId => videosById.get(videoId)).filter(Boolean);
};

const getChannelVideos = async (user, uploadsPlaylistId, { maxResults = 12, pageToken } = {}) => {
    const accessToken = await getValidAccessToken(user);
    const playlistParams = new URLSearchParams({
        part: "snippet,contentDetails",
        playlistId: uploadsPlaylistId,
        maxResults: String(maxResults)
    });

    if (pageToken) {
        playlistParams.set("pageToken", pageToken);
    }

    const playlistRes = await fetch(`${youtubeApiBase}/playlistItems?${playlistParams.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!playlistRes.ok) {
        await throwYoutubeUpstream(playlistRes, "playlistItems", "YOUTUBE_VIDEOS_FAILED", "Failed to fetch videos");
    }
    const playlistData = await playlistRes.json();

    const pagination = {
        nextPageToken: playlistData.nextPageToken || null,
        prevPageToken: playlistData.prevPageToken || null,
        pageInfo: playlistData.pageInfo || {}
    };

    const seenVideoIds = new Set();
    const orderedVideoIds = [];

    for (const item of playlistData.items || []) {
        const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
        if (!videoId || seenVideoIds.has(videoId)) {
            continue;
        }

        seenVideoIds.add(videoId);
        orderedVideoIds.push(videoId);
    }

    if (orderedVideoIds.length === 0) {
        return {
            videos: [],
            ...pagination
        };
    }

    return {
        videos: await fetchVideoDetails(accessToken, orderedVideoIds),
        ...pagination
    };
};

const listCatalogVideos = async (userId, { maxResults = 12, pageToken, searchQuery } = {}) => {
    const filter = { userId };
    const normalizedQuery = searchQuery ? normalizeCatalogText(searchQuery) : "";

    if (normalizedQuery) {
        const safePattern = escapeRegExp(normalizedQuery);
        filter.$or = [
            { normalizedTitle: { $regex: safePattern, $options: "i" } },
            { normalizedDescription: { $regex: safePattern, $options: "i" } }
        ];
    }

    if (pageToken) {
        const cursor = decodeCatalogCursor(pageToken);
        const cursorPublishedAt = cursor.publishedAt || new Date(0);
        filter.$and = [
            ...(filter.$and || []),
            {
                $or: [
                    { publishedAt: { $lt: cursorPublishedAt } },
                    { publishedAt: cursor.publishedAt, _id: { $lt: cursor.id } }
                ]
            }
        ];
    }

    const docs = await VideoCatalog.find(filter)
        .sort({ publishedAt: -1, _id: -1 })
        .limit(maxResults + 1)
        .lean();

    const pageDocs = docs.slice(0, maxResults);
    const hasNextPage = docs.length > maxResults;
    const totalResults = await VideoCatalog.countDocuments(
        searchQuery ? { userId, $or: filter.$or } : { userId }
    );

    return {
        videos: pageDocs.map(toVideoDto),
        nextPageToken: hasNextPage ? encodeCatalogCursor(pageDocs[pageDocs.length - 1]) : null,
        prevPageToken: null,
        pageInfo: {
            totalResults,
            resultsPerPage: pageDocs.length,
            source: "catalog"
        }
    };
};

const syncVideoCatalog = async (user, { maxPages = VIDEO_CATALOG_SYNC_MAX_PAGES } = {}) => {
    const { channelId, uploadsPlaylistId } = await getUserChannelInfo(user);
    const accessToken = await getValidAccessToken(user);
    const syncedAt = new Date();
    let nextPageToken = null;
    let pagesSynced = 0;
    let videosSynced = 0;
    const seenVideoIds = new Set();

    do {
        const playlistParams = new URLSearchParams({
            part: "snippet,contentDetails",
            playlistId: uploadsPlaylistId,
            maxResults: String(VIDEO_CATALOG_SYNC_PAGE_SIZE)
        });

        if (nextPageToken) {
            playlistParams.set("pageToken", nextPageToken);
        }

        const playlistRes = await fetch(`${youtubeApiBase}/playlistItems?${playlistParams.toString()}`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!playlistRes.ok) {
            await throwYoutubeUpstream(playlistRes, "playlistItems", "YOUTUBE_VIDEOS_FAILED", "Failed to sync videos");
        }

        const playlistData = await playlistRes.json();
        const orderedVideoIds = [];

        for (const item of playlistData.items || []) {
            const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
            if (!videoId || seenVideoIds.has(videoId)) {
                continue;
            }

            seenVideoIds.add(videoId);
            orderedVideoIds.push(videoId);
        }

        const videos = await fetchVideoDetails(accessToken, orderedVideoIds);
        if (videos.length > 0) {
            await VideoCatalog.bulkWrite(
                videos.map(video => createCatalogUpdate({ userId: user._id, channelId, video, syncedAt })),
                { ordered: false }
            );
            videosSynced += videos.length;
        }

        pagesSynced++;
        nextPageToken = playlistData.nextPageToken || null;
    } while (nextPageToken && pagesSynced < maxPages);

    return {
        channelId,
        uploadsPlaylistId,
        videosSynced,
        pagesSynced,
        hasMore: Boolean(nextPageToken),
        lastSyncedAt: syncedAt
    };
};

const getCatalogVideos = async (user, { maxResults = 12, pageToken, searchQuery } = {}) => {
    const existingCount = await VideoCatalog.countDocuments({ userId: user._id });
    if (existingCount === 0 && !searchQuery) {
        await syncVideoCatalog(user, { maxPages: 1 });
    }

    return listCatalogVideos(user._id, { maxResults, pageToken, searchQuery });
};

const getCommentSnippet = (item) => item?.snippet?.topLevelComment?.snippet || {};

const toCommentInboxDto = (item) => {
    const snippet = getCommentSnippet(item);

    return {
        commentId: item?.snippet?.topLevelComment?.id || null,
        authorDisplayName: snippet.authorDisplayName || null,
        authorProfileImageUrl: snippet.authorProfileImageUrl || null,
        text: snippet.textOriginal || snippet.textDisplay || "",
        publishedAt: snippet.publishedAt || null,
        updatedAt: snippet.updatedAt || null,
        likeCount: snippet.likeCount ?? null,
        status: "unanswered",
        latestResult: null
    };
};

const getResultTimestamp = (run, result) => {
    const value = result?.updatedAt || result?.createdAt || run?.updatedAt || run?.createdAt;
    const date = value ? new Date(value) : new Date(0);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const toLatestResultDto = (run, result) => ({
    status: result.status,
    errorCode: result.errorCode || null,
    errorMessage: result.errorMessage || null,
    replyTextSnapshot: result.replyTextSnapshot || null,
    draftReplyText: result.draftReplyText || null,
    youtubeReplyId: result.youtubeReplyId || null,
    generatedByAi: result.generatedByAi === undefined ? null : Boolean(result.generatedByAi),
    runId: String(run._id || run.id),
    updatedAt: result.updatedAt || result.createdAt || run.updatedAt || run.createdAt || null
});

const toCommentStateResultDto = (state) => ({
    status: state.status,
    errorCode: state.lastErrorCode || null,
    errorMessage: state.lastErrorMessage || null,
    replyTextSnapshot: state.postedReplyTextSnapshot || null,
    draftReplyText: state.draftReplyText || null,
    youtubeReplyId: state.youtubeReplyId || null,
    generatedByAi: Boolean(state.generatedByAi),
    runId: state.botRunId ? String(state.botRunId) : null,
    updatedAt: state.updatedAt || state.createdAt || null
});

const isBetterCommentResult = (candidate, current) => {
    if (!current) return true;

    const candidatePriority = COMMENT_RESULT_STATUS_PRIORITY[candidate.result.status] || 0;
    const currentPriority = COMMENT_RESULT_STATUS_PRIORITY[current.result.status] || 0;
    if (candidatePriority !== currentPriority) {
        return candidatePriority > currentPriority;
    }

    return candidate.timestamp > current.timestamp;
};

const deriveCommentResultMap = async ({ userId, videoId, commentIds }) => {
    if (commentIds.length === 0) {
        return new Map();
    }

    const runs = await BotRun.find({
        userId,
        videoId,
        "results.commentId": { $in: commentIds }
    })
        .sort({ createdAt: -1 })
        .lean();

    const resultByCommentId = new Map();
    const wantedCommentIds = new Set(commentIds);

    for (const run of runs) {
        for (const result of run.results || []) {
            if (!wantedCommentIds.has(result.commentId) || !COMMENT_RESULT_STATUS_PRIORITY[result.status]) {
                continue;
            }

            const candidate = {
                run,
                result,
                timestamp: getResultTimestamp(run, result)
            };

            if (isBetterCommentResult(candidate, resultByCommentId.get(result.commentId))) {
                resultByCommentId.set(result.commentId, candidate);
            }
        }
    }

    return new Map([...resultByCommentId.entries()].map(([commentId, candidate]) => [
        commentId,
        toLatestResultDto(candidate.run, candidate.result)
    ]));
};

const deriveCommentStateMap = async ({ userId, videoId, commentIds }) => {
    if (commentIds.length === 0) {
        return new Map();
    }

    const states = await CommentReplyState.find({
        userId,
        videoId,
        commentId: { $in: commentIds }
    }).lean();

    return new Map(states.map(state => [state.commentId, toCommentStateResultDto(state)]));
};

const listVideoComments = async (user, videoId, { limit = 20, pageToken, status = "all" } = {}) => {
    await verifyVideoOwnership(user, videoId);

    const { youtube } = await createYoutubeClient(user);
    let response;

    try {
        response = await youtube.commentThreads.list({
            part: "snippet",
            videoId,
            maxResults: limit,
            pageToken: pageToken || undefined,
            order: "time"
        });
    } catch (error) {
        throwYoutubeClientError(error, "commentThreads", "YOUTUBE_COMMENTS_FAILED", "Failed to fetch video comments");
    }

    const pageComments = (response.data.items || [])
        .map(toCommentInboxDto)
        .filter(comment => comment.commentId);
    const resultByCommentId = await deriveCommentResultMap({
        userId: user._id,
        videoId,
        commentIds: pageComments.map(comment => comment.commentId)
    });
    const stateByCommentId = await deriveCommentStateMap({
        userId: user._id,
        videoId,
        commentIds: pageComments.map(comment => comment.commentId)
    });

    const comments = pageComments
        .map(comment => {
            const latestResult = stateByCommentId.get(comment.commentId)
                || resultByCommentId.get(comment.commentId)
                || null;
            return {
                ...comment,
                status: latestResult?.status || "unanswered",
                latestResult
            };
        })
        .filter(comment => status === "all" || comment.status === status);

    return {
        comments,
        nextPageToken: response.data.nextPageToken || null,
        prevPageToken: response.data.prevPageToken || null,
        pageInfo: response.data.pageInfo || {}
    };
};

const getVideoCommentForReply = async (user, videoId, commentId) => {
    await verifyVideoOwnership(user, videoId);

    const { youtube, accessToken } = await createYoutubeClient(user);
    let response;

    try {
        response = await youtube.commentThreads.list({
            part: "snippet",
            id: commentId
        });
    } catch (error) {
        throwYoutubeClientError(error, "commentThreads", "YOUTUBE_COMMENTS_FAILED", "Failed to fetch video comment");
    }

    const item = response.data.items?.[0];
    const comment = item ? toCommentInboxDto(item) : null;
    if (!comment?.commentId) {
        throw notFound("COMMENT_NOT_FOUND", "Comment not found");
    }

    if (item.snippet?.videoId !== videoId) {
        throw forbidden("COMMENT_VIDEO_MISMATCH", "Comment does not belong to this video");
    }

    return { accessToken, comment };
};

const executeSingleCommentReply = async ({ runId, userId, videoId, comment, accessToken, prompt }) => {
    let aiResult;

    try {
        aiResult = await aiProvider.generateReply({
            userId,
            runId,
            videoId,
            commentId: comment.commentId,
            comment: comment.text,
            prompt,
            deferBilling: true
        });

        const insertStartedAt = Date.now();
        const youtubeReplyId = await replyToComment(accessToken, comment.commentId, aiResult.text);
        await aiResult.finalizeBilling();

        const result = {
            commentId: comment.commentId,
            status: "replied",
            runId: String(runId),
            commentTextSnapshot: createTextSnapshot(comment.text),
            replyTextSnapshot: createTextSnapshot(aiResult.text),
            aiLatencyMs: aiResult.latencyMs ?? null,
            youtubeInsertLatencyMs: Date.now() - insertStartedAt,
            attemptCount: aiResult.attemptCount ?? null
        };

        await addRunResult(runId, result);
        await updateCommentReplyStateFromResult({ userId, videoId, result, youtubeReplyId });
        const run = await BotRun.findByIdAndUpdate(runId, {
            status: "completed",
            completedAt: new Date()
        }, { new: true });

        return { run, result };
    } catch (error) {
        if (aiResult?.releaseBilling && error.code === "YOUTUBE_REPLY_FAILED") {
            await aiResult.releaseBilling("youtube-reply-failed");
        }

        const result = {
            commentId: comment.commentId,
            status: "failed",
            runId: String(runId),
            errorCode: error.providerErrorCode || error.code || "COMMENT_FAILED",
            errorMessage: error.isOperational ? error.message : "Failed to process comment",
            commentTextSnapshot: createTextSnapshot(comment.text),
            aiLatencyMs: error.latencyMs ?? null,
            attemptCount: error.attemptCount ?? null
        };

        await addRunResult(runId, result);
        await updateCommentReplyStateFromResult({ userId, videoId, result });
        await BotRun.findByIdAndUpdate(runId, {
            status: "failed",
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            completedAt: new Date()
        }, { new: true });

        if (error.isOperational) {
            error.details = {
                ...(error.details || {}),
                result
            };
        }

        throw error;
    }
};

module.exports = {
    executeBotRun,
    replyToComment,
    getUserChannelInfo,
    getUserChannelId,
    getChannelVideos,
    syncVideoCatalog,
    getCatalogVideos,
    listCatalogVideos,
    listVideoComments,
    getVideoCommentForReply,
    createBulkReplyTasks,
    executeSingleCommentReply,
    createTextSnapshot,
    sleep,
    verifyVideoOwnership
};
