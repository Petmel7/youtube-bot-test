const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const { google } = require("googleapis");

process.env.YOUTUBE_API_BASE = process.env.YOUTUBE_API_BASE || "https://youtube.test/v3";

const youtubeRoutes = require("../src/routes/youtubeRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const BotRun = require("../src/models/BotRun");
const VideoCatalog = require("../src/models/VideoCatalog");
const aiProvider = require("../src/services/ai/aiProvider");
const { validateYoutubeVideosQuery } = require("../src/utils/validators");
const {
    executeBotRun,
    getUserChannelInfo,
    getChannelVideos,
    listCatalogVideos,
    syncVideoCatalog
} = require("../src/services/youtubeService");

const user = {
    _id: "64b000000000000000000010",
    tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expiry_date: Date.now() + 60_000
    }
};

const jsonResponse = (body, ok = true, status = ok ? 200 : 500) => ({
    ok,
    status,
    json: async () => body
});

const createQuery = (docs) => ({
    sort() {
        return this;
    },
    limit(limitArg) {
        this.limitArg = limitArg;
        return this;
    },
    lean() {
        return Promise.resolve(docs.slice(0, this.limitArg || docs.length));
    }
});

const createApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const requestUserId = req.get("X-Test-User");
        req.isAuthenticated = () => Boolean(requestUserId);
        if (requestUserId) req.user = { _id: requestUserId, id: requestUserId, tokens: user.tokens };
        next();
    });
    app.use("/youtube", youtubeRoutes);
    app.use(errorHandler);
    return app;
};

const request = async (app, { method = "GET", path, userId: requestUserId, headers = {} }) => {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        return await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: {
                    ...(requestUserId ? { "X-Test-User": requestUserId } : {}),
                    ...headers
                }
            }, (res) => {
                let rawBody = "";
                res.setEncoding("utf8");
                res.on("data", chunk => {
                    rawBody += chunk;
                });
                res.on("end", () => {
                    resolve({ status: res.statusCode, body: rawBody ? JSON.parse(rawBody) : {} });
                });
            });
            req.on("error", reject);
            req.end();
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
};

test("validateYoutubeVideosQuery defaults and bounds pagination params", () => {
    assert.deepEqual(validateYoutubeVideosQuery({}), {
        maxResults: 12,
        pageToken: undefined,
        searchQuery: undefined
    });
    assert.deepEqual(validateYoutubeVideosQuery({ maxResults: "25", pageToken: "CAUQAA", query: "  launch vlog  " }), {
        maxResults: 25,
        pageToken: "CAUQAA",
        searchQuery: "launch vlog"
    });
    assert.deepEqual(validateYoutubeVideosQuery({ q: "  Я готовлю это блюдо  " }), {
        maxResults: 12,
        pageToken: undefined,
        searchQuery: "Я готовлю это блюдо"
    });

    assert.throws(() => validateYoutubeVideosQuery({ maxResults: "0" }), { code: "INVALID_MAX_RESULTS" });
    assert.throws(() => validateYoutubeVideosQuery({ maxResults: "26" }), { code: "INVALID_MAX_RESULTS" });
    assert.throws(() => validateYoutubeVideosQuery({ maxResults: "ten" }), { code: "INVALID_MAX_RESULTS" });
    assert.throws(() => validateYoutubeVideosQuery({ pageToken: "x".repeat(257) }), { code: "FIELD_TOO_LONG" });
    assert.throws(() => validateYoutubeVideosQuery({ pageToken: "bad token" }), { code: "INVALID_PAGE_TOKEN" });
    assert.throws(() => validateYoutubeVideosQuery({ query: "x".repeat(101) }), { code: "FIELD_TOO_LONG" });
});

test("getUserChannelInfo fetches uploads playlist details", async (t) => {
    t.mock.method(global, "fetch", async (url, options) => {
        const parsed = new URL(url);

        assert.equal(parsed.pathname.endsWith("/channels"), true);
        assert.equal(parsed.searchParams.get("part"), "contentDetails");
        assert.equal(parsed.searchParams.get("mine"), "true");
        assert.equal(options.headers.Authorization, "Bearer access-token");

        return jsonResponse({
            items: [
                {
                    id: "channel-1",
                    contentDetails: {
                        relatedPlaylists: {
                            uploads: "uploads-1"
                        }
                    }
                }
            ]
        });
    });

    const result = await getUserChannelInfo(user);

    assert.deepEqual(result, {
        channelId: "channel-1",
        uploadsPlaylistId: "uploads-1"
    });
});

test("getChannelVideos fetches uploads playlist page and returns pagination metadata", async (t) => {
    const calls = [];
    t.mock.method(global, "fetch", async (url, options) => {
        calls.push({ url: String(url), options });
        const parsed = new URL(url);

        if (parsed.pathname.endsWith("/playlistItems")) {
            assert.equal(parsed.searchParams.get("part"), "snippet,contentDetails");
            assert.equal(parsed.searchParams.get("playlistId"), "uploads-1");
            assert.equal(parsed.searchParams.get("maxResults"), "2");
            assert.equal(parsed.searchParams.get("pageToken"), "CAUQAA");
            assert.equal(options.headers.Authorization, "Bearer access-token");

            return jsonResponse({
                items: [
                    { contentDetails: { videoId: "video-1" } },
                    { contentDetails: { videoId: "video-2" } },
                    { contentDetails: { videoId: "video-1" } },
                    { snippet: { resourceId: { videoId: "video-3" } } },
                    { contentDetails: {} }
                ],
                nextPageToken: "CBQQAA",
                prevPageToken: "CAAQAA",
                pageInfo: {
                    totalResults: 20,
                    resultsPerPage: 2
                }
            });
        }

        if (parsed.pathname.endsWith("/videos")) {
            assert.equal(parsed.searchParams.get("part"), "snippet,contentDetails,statistics,status");
            assert.equal(parsed.searchParams.get("id"), "video-1,video-2,video-3");
            assert.equal(options.headers.Authorization, "Bearer access-token");

            return jsonResponse({
                items: [
                    {
                        id: "video-2",
                        snippet: {
                            title: "Second",
                            description: "Two",
                            publishedAt: "2026-08-02T00:00:00Z",
                            thumbnails: { medium: { url: "https://img.test/2.jpg" } }
                        },
                        contentDetails: { duration: "PT2M" },
                        statistics: { viewCount: "20", likeCount: "3", commentCount: "4" }
                    },
                    {
                        id: "video-1",
                        snippet: {
                            title: "First",
                            description: "One",
                            publishedAt: "2026-08-01T00:00:00Z",
                            thumbnails: { medium: { url: "https://img.test/1.jpg" } }
                        },
                        contentDetails: { duration: "PT1M" },
                        statistics: { viewCount: "10", likeCount: "2", commentCount: "1" }
                    }
                ]
            });
        }

        throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await getChannelVideos(user, "uploads-1", {
        maxResults: 2,
        pageToken: "CAUQAA"
    });

    assert.equal(calls.length, 2);
    assert.equal(calls.some(call => new URL(call.url).pathname.endsWith("/search")), false);
    assert.equal(result.nextPageToken, "CBQQAA");
    assert.equal(result.prevPageToken, "CAAQAA");
    assert.deepEqual(result.pageInfo, { totalResults: 20, resultsPerPage: 2 });
    assert.deepEqual(result.videos.map(video => video.videoId), ["video-1", "video-2"]);
    assert.equal(result.videos.some(video => video.videoId === "video-3"), false);
    assert.equal(result.videos[0].title, "First");
    assert.equal(result.videos[0].views, "10");
});

test("getChannelVideos returns empty page without fetching video details", async (t) => {
    const calls = [];
    t.mock.method(global, "fetch", async (url, options) => {
        calls.push(String(url));
        const parsed = new URL(url);

        assert.equal(parsed.pathname.endsWith("/playlistItems"), true);
        assert.equal(parsed.searchParams.get("part"), "snippet,contentDetails");
        assert.equal(parsed.searchParams.get("playlistId"), "uploads-empty");
        assert.equal(parsed.searchParams.get("maxResults"), "12");
        assert.equal(options.headers.Authorization, "Bearer access-token");

        return jsonResponse({
            items: [],
            pageInfo: {
                totalResults: 0,
                resultsPerPage: 12
            }
        });
    });

    const result = await getChannelVideos(user, "uploads-empty", { maxResults: 12 });

    assert.equal(calls.length, 1);
    assert.deepEqual(result, {
        videos: [],
        nextPageToken: null,
        prevPageToken: null,
        pageInfo: {
            totalResults: 0,
            resultsPerPage: 12
        }
    });
});

test("listCatalogVideos searches cached Cyrillic titles without calling YouTube Search API", async (t) => {
    const docs = [
        {
            _id: "66a000000000000000000002",
            videoId: "video-old",
            title: "Я готовлю это блюдо",
            description: "Домашний рецепт",
            publishedAt: new Date("2026-08-02T00:00:00.000Z"),
            thumbnail: null,
            duration: "PT2M",
            views: "20",
            likes: "2",
            comments: "1"
        }
    ];

    t.mock.method(global, "fetch", async (url) => {
        throw new Error(`Unexpected YouTube call: ${url}`);
    });
    t.mock.method(VideoCatalog, "find", (filter) => {
        assert.equal(String(filter.userId), user._id);
        assert.equal(filter.$or[0].normalizedTitle.$regex, "готовлю");
        return createQuery(docs);
    });
    t.mock.method(VideoCatalog, "countDocuments", async (filter) => {
        assert.equal(String(filter.userId), user._id);
        assert.ok(filter.$or);
        return 1;
    });

    const result = await listCatalogVideos(user._id, { maxResults: 12, searchQuery: "готовлю" });

    assert.equal(result.nextPageToken, null);
    assert.equal(result.pageInfo.source, "catalog");
    assert.equal(result.pageInfo.totalResults, 1);
    assert.deepEqual(result.videos.map(video => video.videoId), ["video-old"]);
});

test("syncVideoCatalog upserts uploads playlist videos without duplicate records", async (t) => {
    const bulkOps = [];
    t.mock.method(global, "fetch", async (url) => {
        const parsed = new URL(url);

        if (parsed.pathname.endsWith("/channels")) {
            return jsonResponse({
                items: [{
                    id: "channel-1",
                    contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
                }]
            });
        }

        if (parsed.pathname.endsWith("/playlistItems")) {
            assert.equal(parsed.searchParams.get("playlistId"), "uploads-1");
            assert.equal(parsed.searchParams.get("maxResults"), "50");
            return jsonResponse({
                items: [
                    { contentDetails: { videoId: "video-1" } },
                    { contentDetails: { videoId: "video-2" } },
                    { contentDetails: { videoId: "video-1" } }
                ]
            });
        }

        if (parsed.pathname.endsWith("/videos")) {
            assert.equal(parsed.searchParams.get("part"), "snippet,contentDetails,statistics,status");
            assert.equal(parsed.searchParams.get("id"), "video-1,video-2");
            return jsonResponse({
                items: [
                    {
                        id: "video-2",
                        snippet: { title: "Second", description: "", publishedAt: "2026-08-02T00:00:00Z", thumbnails: {} },
                        contentDetails: { duration: "PT2M" },
                        statistics: {},
                        status: { privacyStatus: "public", uploadStatus: "processed" }
                    },
                    {
                        id: "video-1",
                        snippet: { title: "First", description: "", publishedAt: "2026-08-01T00:00:00Z", thumbnails: {} },
                        contentDetails: { duration: "PT1M" },
                        statistics: {},
                        status: { privacyStatus: "public", uploadStatus: "processed" }
                    }
                ]
            });
        }

        throw new Error(`Unexpected URL: ${url}`);
    });
    t.mock.method(VideoCatalog, "bulkWrite", async (ops, options) => {
        bulkOps.push(...ops);
        assert.equal(options.ordered, false);
        return { modifiedCount: 0, upsertedCount: ops.length };
    });

    const result = await syncVideoCatalog(user);

    assert.equal(result.videosSynced, 2);
    assert.equal(result.pagesSynced, 1);
    assert.equal(result.hasMore, false);
    assert.equal(bulkOps.length, 2);
    assert.deepEqual(bulkOps.map(op => op.updateOne.filter.videoId), ["video-1", "video-2"]);
    assert.equal(bulkOps[0].updateOne.filter.userId, user._id);
    assert.equal(bulkOps[0].updateOne.update.$set.normalizedTitle, "first");
});

test("syncVideoCatalog maps YouTube quota failures to safe error code", async (t) => {
    t.mock.method(console, "warn", () => {});
    t.mock.method(global, "fetch", async (url) => {
        const parsed = new URL(url);

        if (parsed.pathname.endsWith("/channels")) {
            return jsonResponse({
                items: [{
                    id: "channel-1",
                    contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
                }]
            });
        }

        if (parsed.pathname.endsWith("/playlistItems")) {
            return jsonResponse({
                error: {
                    code: 429,
                    errors: [{ reason: "rateLimitExceeded" }]
                }
            }, false, 429);
        }

        throw new Error(`Unexpected URL: ${url}`);
    });

    await assert.rejects(
        () => syncVideoCatalog(user),
        { code: "YOUTUBE_QUOTA_EXCEEDED", status: 502 }
    );
});

test("executeBotRun stores provider-specific AI error codes in comment results", async (t) => {
    const updates = [];
    let findByIdCalls = 0;

    t.mock.method(global, "fetch", async (url) => {
        const parsed = new URL(url);

        if (parsed.pathname.endsWith("/channels")) {
            return jsonResponse({
                items: [{
                    id: "channel-1",
                    contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
                }]
            });
        }

        throw new Error(`Unexpected fetch URL: ${url}`);
    });

    t.mock.method(google, "youtube", () => ({
        videos: {
            async list() {
                return { data: { items: [{ snippet: { channelId: "channel-1" } }] } };
            }
        },
        commentThreads: {
            async list() {
                return {
                    data: {
                        items: [{
                            snippet: {
                                topLevelComment: {
                                    id: "comment-1",
                                    snippet: { textOriginal: "Great recipe!" }
                                }
                            }
                        }]
                    }
                };
            }
        },
        comments: {
            async insert() {
                throw new Error("comments.insert should not be called after AI failure");
            }
        }
    }));
    t.mock.method(BotRun, "exists", async () => false);
    t.mock.method(BotRun, "findById", async () => {
        findByIdCalls += 1;
        if (findByIdCalls === 1) {
            return { _id: "66b000000000000000000001", status: "queued" };
        }

        return {
            _id: "66b000000000000000000001",
            successCount: 0,
            failureCount: 1,
            skippedCount: 0
        };
    });
    t.mock.method(BotRun, "findByIdAndUpdate", async (runId, update) => {
        updates.push({ runId, update });
        return {};
    });
    t.mock.method(aiProvider, "generateReply", async () => {
        const error = new Error("Gemini generation failed");
        error.code = "GEMINI_PROVIDER_ERROR";
        error.providerErrorCode = "GEMINI_RATE_LIMIT";
        error.isOperational = true;
        throw error;
    });

    await executeBotRun("66b000000000000000000001", user, "abcDEF12345", "Reply politely");

    const resultUpdate = updates.find(entry => entry.update.$push?.results);
    assert.equal(resultUpdate.update.$push.results.errorCode, "GEMINI_RATE_LIMIT");
    assert.equal(resultUpdate.update.$push.results.errorMessage, "Gemini generation failed");

    const finalUpdate = updates.find(entry => entry.update.status === "failed");
    assert.equal(finalUpdate.update.errorCode, "BOT_RUN_NO_REPLIES");
});

test("POST /youtube/my-videos/refresh requires auth and write header", async (t) => {
    const app = createApp();

    const unauthenticated = await request(app, { method: "POST", path: "/youtube/my-videos/refresh" });
    assert.equal(unauthenticated.status, 401);

    const missingHeader = await request(app, {
        method: "POST",
        path: "/youtube/my-videos/refresh",
        userId: user._id
    });
    assert.equal(missingHeader.status, 403);
    assert.equal(missingHeader.body.error.code, "CSRF_HEADER_REQUIRED");

    t.mock.method(global, "fetch", async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/channels")) {
            return jsonResponse({
                items: [{
                    id: "channel-1",
                    contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
                }]
            });
        }
        if (parsed.pathname.endsWith("/playlistItems")) {
            return jsonResponse({ items: [] });
        }
        throw new Error(`Unexpected URL: ${url}`);
    });
    t.mock.method(VideoCatalog, "bulkWrite", async () => {
        throw new Error("bulkWrite should not run for an empty sync page");
    });

    const ok = await request(app, {
        method: "POST",
        path: "/youtube/my-videos/refresh",
        userId: user._id,
        headers: { "X-CSRF-Protection": "1" }
    });

    assert.equal(ok.status, 202);
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.sync.pagesSynced, 1);
});

test("GET /youtube/my-videos query reads catalog and does not call YouTube search", async (t) => {
    const app = createApp();
    t.mock.method(global, "fetch", async (url) => {
        throw new Error(`Unexpected YouTube call: ${url}`);
    });
    t.mock.method(VideoCatalog, "find", (filter) => {
        assert.equal(String(filter.userId), user._id);
        assert.equal(filter.$or[0].normalizedTitle.$regex, "готовлю");
        return createQuery([{
            _id: "66a000000000000000000002",
            videoId: "video-old",
            title: "Я готовлю это блюдо",
            description: "",
            publishedAt: new Date("2026-08-02T00:00:00.000Z"),
            thumbnail: null,
            duration: null,
            views: null,
            likes: null,
            comments: null
        }]);
    });
    t.mock.method(VideoCatalog, "countDocuments", async () => 1);

    const response = await request(app, {
        path: "/youtube/my-videos?maxResults=12&query=%D0%B3%D0%BE%D1%82%D0%BE%D0%B2%D0%BB%D1%8E",
        userId: user._id
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.videos.map(video => video.videoId), ["video-old"]);
    assert.equal(response.body.pageInfo.source, "catalog");
});
