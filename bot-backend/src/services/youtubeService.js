const fetch = require("node-fetch");
const { google } = require("googleapis");
const BotRun = require("../models/BotRun");
const { getValidAccessToken } = require("./authService");
const { generateResponse } = require("./geminiService");
const {
    googleClientId,
    googleClientSecret,
    googleRedirectUri,
    youtubeApiBase,
    botMaxCommentsPerRun,
    botMaxPagesPerRun
} = require("../config/config");
const { forbidden, notFound, upstream } = require("../utils/errors");

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

const hasPreviouslyReplied = async (userId, videoId, commentId) => {
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

async function executeBotRun(runId, user, videoId, userPrompt) {
    const run = await BotRun.findById(runId);
    if (!run || run.status !== "queued") {
        return;
    }

    await BotRun.findByIdAndUpdate(runId, { status: "running", startedAt: new Date() });

    try {
        await verifyVideoOwnership(user, videoId);

        const { youtube, accessToken } = await createYoutubeClient(user);
        let nextPageToken = null;
        let pageCount = 0;
        let processed = 0;

        do {
            pageCount++;
            const response = await youtube.commentThreads.list({
                part: "snippet",
                videoId,
                maxResults: Math.min(100, botMaxCommentsPerRun),
                pageToken: nextPageToken || undefined
            });

            const items = response.data.items || [];
            for (const item of items) {
                if (processed >= botMaxCommentsPerRun) break;

                const commentId = item.snippet?.topLevelComment?.id;
                const commentText = item.snippet?.topLevelComment?.snippet?.textOriginal;
                if (!commentId || !commentText) {
                    await addRunResult(runId, {
                        commentId: commentId || "unknown",
                        status: "skipped",
                        errorCode: "INVALID_COMMENT",
                        errorMessage: "Comment data was incomplete"
                    });
                    processed++;
                    continue;
                }

                if (await hasPreviouslyReplied(user._id, videoId, commentId)) {
                    await addRunResult(runId, { commentId, status: "skipped" });
                    processed++;
                    continue;
                }

                try {
                    const responseText = await generateResponse(commentText, userPrompt);
                    await replyToComment(accessToken, commentId, responseText);
                    await addRunResult(runId, { commentId, status: "replied" });
                } catch (error) {
                    await addRunResult(runId, {
                        commentId,
                        status: "failed",
                        errorCode: error.code || "COMMENT_FAILED",
                        errorMessage: error.isOperational ? error.message : "Failed to process comment"
                    });
                }

                processed++;
            }

            nextPageToken = processed < botMaxCommentsPerRun ? response.data.nextPageToken || null : null;
        } while (nextPageToken && pageCount < botMaxPagesPerRun);

        const completedRun = await BotRun.findById(runId);
        const status = completedRun.failureCount > 0
            ? (completedRun.successCount > 0 || completedRun.skippedCount > 0 ? "partial" : "failed")
            : "completed";

        await BotRun.findByIdAndUpdate(runId, {
            status,
            completedAt: new Date(),
            errorCode: status === "failed" ? "BOT_RUN_NO_REPLIES" : undefined,
            errorMessage: status === "failed" ? "Bot run did not create any replies" : undefined
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
        await youtube.comments.insert({
            part: "snippet",
            resource: {
                snippet: {
                    parentId: commentId,
                    textOriginal: responseText
                }
            }
        });
    } catch (error) {
        throw upstream("YOUTUBE_REPLY_FAILED", "Failed to reply to YouTube comment");
    }
}

const getUserChannelId = async (user) => {
    const accessToken = await getValidAccessToken(user);

    const res = await fetch(`${youtubeApiBase}/channels?part=id&mine=true`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) throw upstream("YOUTUBE_CHANNEL_FAILED", "Failed to fetch channel ID");
    const data = await res.json();

    if (!data.items?.length) throw notFound("YOUTUBE_CHANNEL_NOT_FOUND", "No channels found for user");
    return data.items[0].id;
};

const getChannelVideos = async (user, channelId) => {
    const accessToken = await getValidAccessToken(user);

    const searchRes = await fetch(`${youtubeApiBase}/search?part=snippet&channelId=${channelId}&type=video&maxResults=50`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!searchRes.ok) throw upstream("YOUTUBE_VIDEOS_FAILED", "Failed to fetch videos");
    const searchData = await searchRes.json();

    const videoIds = (searchData.items || []).map(item => item.id.videoId).filter(Boolean).join(",");
    if (!videoIds) return [];

    const detailsRes = await fetch(`${youtubeApiBase}/videos?part=snippet,contentDetails,statistics&id=${videoIds}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!detailsRes.ok) throw upstream("YOUTUBE_VIDEO_DETAILS_FAILED", "Failed to fetch video details");
    const detailsData = await detailsRes.json();

    return (detailsData.items || []).map(video => ({
        videoId: video.id,
        title: video.snippet?.title || "",
        description: video.snippet?.description || "",
        publishedAt: video.snippet?.publishedAt || null,
        thumbnail: video.snippet?.thumbnails?.medium?.url || null,
        duration: video.contentDetails?.duration || null,
        views: video.statistics?.viewCount || null,
        likes: video.statistics?.likeCount || null,
        comments: video.statistics?.commentCount || null
    }));
};

module.exports = {
    executeBotRun,
    replyToComment,
    getUserChannelId,
    getChannelVideos,
    verifyVideoOwnership
};
