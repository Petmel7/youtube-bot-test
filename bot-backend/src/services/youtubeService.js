const { google } = require("googleapis");
const BotRun = require("../models/BotRun");
const { getValidAccessToken } = require("./authService");
const aiProvider = require("./ai/aiProvider");
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
                    const response = await aiProvider.generateReply({
                        userId: user._id,
                        runId,
                        videoId,
                        commentId,
                        comment: commentText,
                        prompt: userPrompt
                    });
                    const responseText = response.text;
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

const fetchVideoDetails = async (accessToken, orderedVideoIds) => {
    if (orderedVideoIds.length === 0) {
        return [];
    }

    const videoIds = orderedVideoIds.join(",");
    const detailsRes = await fetch(`${youtubeApiBase}/videos?part=snippet,contentDetails,statistics&id=${videoIds}`, {
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
            comments: video.statistics?.commentCount || null
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

const searchChannelVideos = async (user, channelId, searchQuery, { maxResults = 12, pageToken } = {}) => {
    const accessToken = await getValidAccessToken(user);
    const searchParams = new URLSearchParams({
        part: "snippet",
        channelId,
        type: "video",
        q: searchQuery,
        order: "relevance",
        maxResults: String(maxResults)
    });

    if (pageToken) {
        searchParams.set("pageToken", pageToken);
    }

    const searchRes = await fetch(`${youtubeApiBase}/search?${searchParams.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!searchRes.ok) {
        await throwYoutubeUpstream(searchRes, "search", "YOUTUBE_SEARCH_FAILED", "Video search is temporarily unavailable");
    }
    const searchData = await searchRes.json();

    const pagination = {
        nextPageToken: searchData.nextPageToken || null,
        prevPageToken: searchData.prevPageToken || null,
        pageInfo: searchData.pageInfo || {}
    };

    const seenVideoIds = new Set();
    const orderedVideoIds = [];

    for (const item of searchData.items || []) {
        const videoId = item.id?.videoId;
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

module.exports = {
    executeBotRun,
    replyToComment,
    getUserChannelInfo,
    getUserChannelId,
    getChannelVideos,
    searchChannelVideos,
    verifyVideoOwnership
};
