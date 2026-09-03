const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const { google } = require("googleapis");

process.env.YOUTUBE_API_BASE = process.env.YOUTUBE_API_BASE || "https://youtube.test/v3";

const youtubeRoutes = require("../src/routes/youtubeRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const BotRun = require("../src/models/BotRun");
const CommentReplyState = require("../src/models/CommentReplyState");
const VideoCatalog = require("../src/models/VideoCatalog");
const aiProvider = require("../src/services/ai/aiProvider");
const { validateYoutubeCommentsQuery, validateYoutubeVideosQuery } = require("../src/utils/validators");
const {
    executeBotRun,
    executeSingleCommentReply,
    createTextSnapshot,
    getUserChannelInfo,
    getChannelVideos,
    listCatalogVideos,
    listVideoComments,
    createBulkReplyTasks,
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

const mockCommentReplyStateEmpty = (t) => {
    t.mock.method(CommentReplyState, "exists", async () => false);
    t.mock.method(CommentReplyState, "findOneAndUpdate", async () => ({}));
    t.mock.method(CommentReplyState, "find", () => ({
        sort() {
            return Promise.resolve([]);
        },
        lean: async () => []
    }));
};

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

test("validateYoutubeCommentsQuery defaults and validates filters", () => {
    assert.deepEqual(validateYoutubeCommentsQuery({}), {
        limit: 20,
        pageToken: undefined,
        status: "all"
    });
    assert.deepEqual(validateYoutubeCommentsQuery({ limit: "50", pageToken: "CAUQAA", status: "drafted" }), {
        limit: 50,
        pageToken: "CAUQAA",
        status: "drafted"
    });

    assert.throws(() => validateYoutubeCommentsQuery({ limit: "0" }), { code: "INVALID_LIMIT" });
    assert.throws(() => validateYoutubeCommentsQuery({ limit: "51" }), { code: "INVALID_LIMIT" });
    assert.throws(() => validateYoutubeCommentsQuery({ pageToken: "bad token" }), { code: "INVALID_PAGE_TOKEN" });
    assert.throws(() => validateYoutubeCommentsQuery({ status: "archived" }), { code: "INVALID_COMMENT_STATUS" });
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

test("listVideoComments returns paginated comments decorated with BotRun statuses", async (t) => {
    mockCommentReplyStateEmpty(t);
    const googleCalls = [];
    t.mock.method(global, "fetch", async (url, options) => {
        const parsed = new URL(url);

        assert.equal(parsed.pathname.endsWith("/channels"), true);
        assert.equal(parsed.searchParams.get("mine"), "true");
        assert.equal(options.headers.Authorization, "Bearer access-token");

        return jsonResponse({
            items: [{
                id: "channel-1",
                contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
            }]
        });
    });
    t.mock.method(google, "youtube", () => ({
        videos: {
            async list(args) {
                googleCalls.push({ type: "videos", args });
                assert.equal(args.id, "abcDEF12345");
                return { data: { items: [{ snippet: { channelId: "channel-1" } }] } };
            }
        },
        commentThreads: {
            async list(args) {
                googleCalls.push({ type: "commentThreads", args });
                assert.equal(args.part, "snippet");
                assert.equal(args.videoId, "abcDEF12345");
                assert.equal(args.maxResults, 3);
                assert.equal(args.pageToken, "CAUQAA");
                assert.equal(args.order, "time");

                return {
                    data: {
                        items: [
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-1",
                                        snippet: {
                                            authorDisplayName: "Viewer One",
                                            authorProfileImageUrl: "https://img.test/1.jpg",
                                            textOriginal: "Great recipe!",
                                            publishedAt: "2026-09-01T10:00:00Z",
                                            updatedAt: "2026-09-01T10:00:00Z",
                                            likeCount: 2
                                        }
                                    }
                                }
                            },
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-2",
                                        snippet: {
                                            authorDisplayName: "Viewer Two",
                                            textOriginal: "This failed?",
                                            publishedAt: "2026-09-01T11:00:00Z",
                                            likeCount: 0
                                        }
                                    }
                                }
                            },
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-3",
                                        snippet: {
                                            authorDisplayName: "Viewer Three",
                                            textOriginal: "Still unanswered.",
                                            publishedAt: "2026-09-01T12:00:00Z"
                                        }
                                    }
                                }
                            }
                        ],
                        nextPageToken: "CBQQAA",
                        pageInfo: { resultsPerPage: 3 }
                    }
                };
            }
        }
    }));
    t.mock.method(BotRun, "find", (filter) => {
        assert.equal(String(filter.userId), user._id);
        assert.equal(filter.videoId, "abcDEF12345");
        assert.deepEqual(filter["results.commentId"].$in, ["comment-1", "comment-2", "comment-3"]);

        return createQuery([
            {
                _id: "66b000000000000000000002",
                userId: user._id,
                videoId: "abcDEF12345",
                createdAt: new Date("2026-09-02T00:00:00Z"),
                results: [
                    {
                        commentId: "comment-1",
                        status: "skipped",
                        updatedAt: new Date("2026-09-02T00:01:00Z")
                    },
                    {
                        commentId: "comment-2",
                        status: "failed",
                        errorCode: "GEMINI_RATE_LIMIT",
                        errorMessage: "Gemini generation failed",
                        updatedAt: new Date("2026-09-02T00:02:00Z")
                    }
                ]
            },
            {
                _id: "66b000000000000000000001",
                userId: user._id,
                videoId: "abcDEF12345",
                createdAt: new Date("2026-09-01T00:00:00Z"),
                results: [
                    {
                        commentId: "comment-1",
                        status: "replied",
                        replyTextSnapshot: "Thanks for watching!",
                        updatedAt: new Date("2026-09-01T00:01:00Z")
                    }
                ]
            }
        ]);
    });

    const result = await listVideoComments(user, "abcDEF12345", {
        limit: 3,
        pageToken: "CAUQAA"
    });

    assert.deepEqual(googleCalls.map(call => call.type), ["videos", "commentThreads"]);
    assert.equal(result.nextPageToken, "CBQQAA");
    assert.equal(result.comments.length, 3);
    assert.equal(result.comments[0].status, "replied");
    assert.equal(result.comments[0].latestResult.replyTextSnapshot, "Thanks for watching!");
    assert.equal(result.comments[0].authorDisplayName, "Viewer One");
    assert.equal(result.comments[0].likeCount, 2);
    assert.equal(result.comments[1].status, "failed");
    assert.equal(result.comments[1].latestResult.errorCode, "GEMINI_RATE_LIMIT");
    assert.equal(result.comments[2].status, "unanswered");
    assert.equal(result.comments[2].latestResult, null);
    assert.equal(result.comments[0].latestResult.prompt, undefined);
});

test("listVideoComments applies status filter to the decorated page", async (t) => {
    mockCommentReplyStateEmpty(t);
    t.mock.method(global, "fetch", async () => jsonResponse({
        items: [{
            id: "channel-1",
            contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
        }]
    }));
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
                        items: [
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-1",
                                        snippet: { authorDisplayName: "Viewer", textOriginal: "Thanks!" }
                                    }
                                }
                            },
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-2",
                                        snippet: { authorDisplayName: "Viewer", textOriginal: "Needs answer." }
                                    }
                                }
                            }
                        ]
                    }
                };
            }
        }
    }));
    t.mock.method(BotRun, "find", () => createQuery([
        {
            _id: "66b000000000000000000001",
            createdAt: new Date("2026-09-01T00:00:00Z"),
            results: [{ commentId: "comment-1", status: "replied", replyTextSnapshot: "You're welcome!" }]
        }
    ]));

    const result = await listVideoComments(user, "abcDEF12345", { status: "unanswered" });

    assert.deepEqual(result.comments.map(comment => comment.commentId), ["comment-2"]);
    assert.equal(result.comments[0].status, "unanswered");
});

test("listVideoComments decorates drafts from comment reply state", async (t) => {
    t.mock.method(global, "fetch", async () => jsonResponse({
        items: [{
            id: "channel-1",
            contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
        }]
    }));
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
                                    snippet: { authorDisplayName: "Viewer", textOriginal: "Can I use dill?" }
                                }
                            }
                        }]
                    }
                };
            }
        }
    }));
    t.mock.method(BotRun, "find", () => createQuery([]));
    t.mock.method(CommentReplyState, "find", () => ({
        lean: async () => [{
            commentId: "comment-1",
            status: "drafted",
            draftReplyText: "Yes, dill would work nicely here.",
            generatedByAi: true,
            updatedAt: new Date("2026-09-02T00:00:00Z")
        }]
    }));

    const result = await listVideoComments(user, "abcDEF12345", { status: "drafted" });

    assert.equal(result.comments.length, 1);
    assert.equal(result.comments[0].status, "drafted");
    assert.equal(result.comments[0].latestResult.draftReplyText, "Yes, dill would work nicely here.");
    assert.equal(result.comments[0].latestResult.generatedByAi, true);
});

test("createBulkReplyTasks creates queued tasks for eligible comments", async (t) => {
    const updates = [];
    t.mock.method(global, "fetch", async () => jsonResponse({
        items: [{
            id: "channel-1",
            contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
        }]
    }));
    t.mock.method(google, "youtube", () => ({
        videos: {
            async list() {
                return { data: { items: [{ snippet: { channelId: "channel-1" } }] } };
            }
        },
        commentThreads: {
            async list(args) {
                assert.equal(args.videoId, "abcDEF12345");
                assert.equal(args.order, "time");
                return {
                    data: {
                        items: [
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-1",
                                        snippet: { textOriginal: "  Great recipe!\nThanks.  " }
                                    }
                                }
                            },
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-2",
                                        snippet: { textOriginal: "Can I use dill?" }
                                    }
                                }
                            }
                        ]
                    }
                };
            }
        }
    }));
    t.mock.method(CommentReplyState, "exists", async ({ commentId }) => commentId === "comment-2");
    t.mock.method(BotRun, "exists", async () => false);
    t.mock.method(CommentReplyState, "updateOne", async (filter, update) => {
        updates.push({ filter, update });
        return { upsertedCount: 1, modifiedCount: 0 };
    });
    t.mock.method(CommentReplyState, "find", () => ({
        sort() {
            return Promise.resolve(updates.map((entry, index) => ({
                _id: `state-${index}`,
                commentId: entry.filter.commentId,
                status: "queued",
                botRunId: "66b000000000000000000001",
                commentTextSnapshot: entry.update.$set.commentTextSnapshot,
                attempts: 0
            })));
        }
    }));
    t.mock.method(BotRun, "findByIdAndUpdate", async () => ({}));

    const result = await createBulkReplyTasks(user, "abcDEF12345", "66b000000000000000000001");

    assert.equal(result.created, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.total, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].filter.commentId, "comment-1");
    assert.equal(updates[0].update.$setOnInsert.status, "queued");
    assert.equal(updates[0].update.$setOnInsert.taskType, "bulk-reply");
    assert.equal(updates[0].update.$set.commentTextSnapshot, "Great recipe! Thanks.");
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
    mockCommentReplyStateEmpty(t);
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
            skippedCount: 1
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
    assert.equal(resultUpdate.update.$push.results.commentTextSnapshot, "Great recipe!");
    assert.equal(resultUpdate.update.$push.results.replyTextSnapshot, undefined);

    const finalUpdate = updates.find(entry => entry.update.status === "partial" || entry.update.status === "failed");
    assert.equal(finalUpdate.update.errorCode, "GEMINI_RATE_LIMIT");
    assert.equal(finalUpdate.update.errorMessage, "AI provider rate limit reached");
});

test("executeBotRun stops early after Gemini rate limit to avoid burning quota", async (t) => {
    mockCommentReplyStateEmpty(t);
    const updates = [];
    let findByIdCalls = 0;
    let aiCalls = 0;

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
                        items: [
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-1",
                                        snippet: { textOriginal: "Great recipe!" }
                                    }
                                }
                            },
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-2",
                                        snippet: { textOriginal: "Can I add paprika?" }
                                    }
                                }
                            }
                        ]
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
        aiCalls += 1;
        const error = new Error("Gemini generation failed");
        error.code = "GEMINI_PROVIDER_ERROR";
        error.providerErrorCode = "GEMINI_RATE_LIMIT";
        error.isOperational = true;
        throw error;
    });

    await executeBotRun("66b000000000000000000001", user, "abcDEF12345", "Reply politely");

    const resultUpdates = updates.filter(entry => entry.update.$push?.results);
    assert.equal(aiCalls, 1);
    assert.equal(resultUpdates.length, 2);
    assert.equal(resultUpdates[0].update.$push.results.commentId, "comment-1");
    assert.equal(resultUpdates[0].update.$push.results.status, "failed");
    assert.equal(resultUpdates[0].update.$push.results.errorCode, "GEMINI_RATE_LIMIT");
    assert.equal(resultUpdates[1].update.$push.results.commentId, "comment-2");
    assert.equal(resultUpdates[1].update.$push.results.status, "skipped");
    assert.equal(resultUpdates[1].update.$push.results.errorCode, "GEMINI_RATE_LIMIT");
    assert.equal(resultUpdates[1].update.$push.results.errorMessage, "AI provider rate limit reached");

    const finalUpdate = updates.find(entry => entry.update.status === "partial" || entry.update.status === "failed");
    assert.equal(finalUpdate.update.errorCode, "GEMINI_RATE_LIMIT");
    assert.equal(finalUpdate.update.errorMessage, "AI provider rate limit reached");
});

test("executeBotRun records separate AI and YouTube insert latency diagnostics", async (t) => {
    mockCommentReplyStateEmpty(t);
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
                return {};
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
            successCount: 1,
            failureCount: 0,
            skippedCount: 0
        };
    });
    t.mock.method(BotRun, "findByIdAndUpdate", async (runId, update) => {
        updates.push({ runId, update });
        return {};
    });
    t.mock.method(aiProvider, "generateReply", async () => ({
        text: "Thanks for noticing the sauce balance in this recipe.",
        latencyMs: 1234,
        attemptCount: 1
    }));

    await executeBotRun("66b000000000000000000001", user, "abcDEF12345", "Reply politely");

    const resultUpdate = updates.find(entry => entry.update.$push?.results);
    assert.equal(resultUpdate.update.$push.results.status, "replied");
    assert.equal(resultUpdate.update.$push.results.commentTextSnapshot, "Great recipe!");
    assert.equal(resultUpdate.update.$push.results.replyTextSnapshot, "Thanks for noticing the sauce balance in this recipe.");
    assert.equal(resultUpdate.update.$push.results.aiLatencyMs, 1234);
    assert.equal(Number.isInteger(resultUpdate.update.$push.results.youtubeInsertLatencyMs), true);
    assert.equal(resultUpdate.update.$push.results.attemptCount, 1);
});

test("executeSingleCommentReply posts one reply, finalizes billing, and stores result", async (t) => {
    mockCommentReplyStateEmpty(t);
    const updates = [];
    let finalized = false;
    let released = false;

    t.mock.method(google, "youtube", () => ({
        comments: {
            async insert(args) {
                assert.equal(args.resource.snippet.parentId, "comment-1");
                assert.equal(args.resource.snippet.textOriginal, "Thanks for the kind note about the recipe.");
                return {};
            }
        }
    }));
    t.mock.method(BotRun, "findByIdAndUpdate", async (runId, update) => {
        updates.push({ runId, update });
        return {
            _id: runId,
            mode: "single-comment",
            status: update.status || "running",
            results: []
        };
    });
    t.mock.method(aiProvider, "generateReply", async (args) => {
        assert.equal(args.deferBilling, true);
        assert.equal(args.commentId, "comment-1");
        return {
            text: "Thanks for the kind note about the recipe.",
            latencyMs: 120,
            attemptCount: 1,
            finalizeBilling: async () => {
                finalized = true;
            },
            releaseBilling: async () => {
                released = true;
            }
        };
    });

    const result = await executeSingleCommentReply({
        runId: "66b000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        comment: { commentId: "comment-1", text: "Great recipe!" },
        accessToken: "access-token",
        prompt: "Reply politely"
    });

    assert.equal(finalized, true);
    assert.equal(released, false);
    assert.equal(result.result.status, "replied");
    assert.equal(result.result.commentTextSnapshot, "Great recipe!");
    assert.equal(result.result.replyTextSnapshot, "Thanks for the kind note about the recipe.");
    assert.equal(updates.find(entry => entry.update.$push?.results).update.$push.results.status, "replied");
    assert.equal(updates.find(entry => entry.update.status === "completed").update.completedAt instanceof Date, true);
});

test("executeSingleCommentReply releases deferred billing when YouTube posting fails", async (t) => {
    mockCommentReplyStateEmpty(t);
    const updates = [];
    let finalized = false;
    let releasedReason = null;

    t.mock.method(google, "youtube", () => ({
        comments: {
            async insert() {
                throw new Error("YouTube insert failed");
            }
        }
    }));
    t.mock.method(BotRun, "findByIdAndUpdate", async (runId, update) => {
        updates.push({ runId, update });
        return {};
    });
    t.mock.method(aiProvider, "generateReply", async () => ({
        text: "Thanks for the kind note about the recipe.",
        latencyMs: 120,
        attemptCount: 1,
        finalizeBilling: async () => {
            finalized = true;
        },
        releaseBilling: async (reason) => {
            releasedReason = reason;
        }
    }));

    await assert.rejects(
        () => executeSingleCommentReply({
            runId: "66b000000000000000000001",
            userId: user._id,
            videoId: "abcDEF12345",
            comment: { commentId: "comment-1", text: "Great recipe!" },
            accessToken: "access-token",
            prompt: "Reply politely"
        }),
        { code: "YOUTUBE_REPLY_FAILED" }
    );

    assert.equal(finalized, false);
    assert.equal(releasedReason, "youtube-reply-failed");
    const resultUpdate = updates.find(entry => entry.update.$push?.results);
    assert.equal(resultUpdate.update.$push.results.status, "failed");
    assert.equal(resultUpdate.update.$push.results.errorCode, "YOUTUBE_REPLY_FAILED");
    assert.equal(updates.find(entry => entry.update.status === "failed").update.errorCode, "YOUTUBE_REPLY_FAILED");
});

test("executeBotRun spaces Gemini requests between comments without delaying the first", async (t) => {
    mockCommentReplyStateEmpty(t);
    const updates = [];
    const sleeps = [];
    let findByIdCalls = 0;
    let aiCalls = 0;
    let insertCalls = 0;

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
                        items: [
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-1",
                                        snippet: { textOriginal: "Great sauce balance." }
                                    }
                                }
                            },
                            {
                                snippet: {
                                    topLevelComment: {
                                        id: "comment-2",
                                        snippet: { textOriginal: "Can I add paprika?" }
                                    }
                                }
                            }
                        ]
                    }
                };
            }
        },
        comments: {
            async insert() {
                insertCalls++;
                return {};
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
            successCount: 2,
            failureCount: 0,
            skippedCount: 0
        };
    });
    t.mock.method(BotRun, "findByIdAndUpdate", async (runId, update) => {
        updates.push({ runId, update });
        return {};
    });
    t.mock.method(aiProvider, "generateReply", async () => {
        aiCalls++;
        assert.equal(sleeps.length, aiCalls === 1 ? 0 : 1);
        return {
            text: `Reply ${aiCalls} with a concrete helpful detail.`,
            latencyMs: 100 + aiCalls,
            attemptCount: 1
        };
    });

    await executeBotRun("66b000000000000000000001", user, "abcDEF12345", "Reply politely", {
        requestSpacingMs: 25,
        sleepFn: async (ms) => {
            sleeps.push(ms);
        }
    });

    assert.equal(aiCalls, 2);
    assert.equal(insertCalls, 2);
    assert.deepEqual(sleeps, [25]);
    assert.equal(updates.filter(entry => entry.update.$push?.results).length, 2);
});

test("createTextSnapshot normalizes whitespace and limits stored text length", () => {
    assert.equal(createTextSnapshot("  A viewer\n\ncomment\twith spacing.  "), "A viewer comment with spacing.");
    assert.equal(createTextSnapshot(""), null);
    assert.equal(createTextSnapshot(null), null);
    assert.equal(createTextSnapshot("x".repeat(1200)).length, 1000);
});

test("executeBotRun stores comment snapshots for skipped previously replied comments", async (t) => {
    mockCommentReplyStateEmpty(t);
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
                                    snippet: { textOriginal: "  I already got a reply.\nThanks!  " }
                                }
                            }
                        }]
                    }
                };
            }
        },
        comments: {
            async insert() {
                throw new Error("comments.insert should not be called for skipped comments");
            }
        }
    }));
    t.mock.method(BotRun, "exists", async () => true);
    t.mock.method(BotRun, "findById", async () => {
        findByIdCalls += 1;
        if (findByIdCalls === 1) {
            return { _id: "66b000000000000000000001", status: "queued" };
        }

        return {
            _id: "66b000000000000000000001",
            successCount: 0,
            failureCount: 0,
            skippedCount: 1
        };
    });
    t.mock.method(BotRun, "findByIdAndUpdate", async (runId, update) => {
        updates.push({ runId, update });
        return {};
    });
    t.mock.method(aiProvider, "generateReply", async () => {
        throw new Error("generateReply should not be called for skipped comments");
    });

    await executeBotRun("66b000000000000000000001", user, "abcDEF12345", "Reply politely");

    const resultUpdate = updates.find(entry => entry.update.$push?.results);
    assert.equal(resultUpdate.update.$push.results.status, "skipped");
    assert.equal(resultUpdate.update.$push.results.commentTextSnapshot, "I already got a reply. Thanks!");
    assert.equal(resultUpdate.update.$push.results.replyTextSnapshot, undefined);
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

test("GET /youtube/videos/:videoId/comments requires auth and validates query", async () => {
    const app = createApp();

    const unauthenticated = await request(app, {
        path: "/youtube/videos/abcDEF12345/comments"
    });
    assert.equal(unauthenticated.status, 401);

    const invalidVideo = await request(app, {
        path: "/youtube/videos/short/comments",
        userId: user._id
    });
    assert.equal(invalidVideo.status, 422);
    assert.equal(invalidVideo.body.error.code, "INVALID_VIDEO_ID");

    const invalidStatus = await request(app, {
        path: "/youtube/videos/abcDEF12345/comments?status=archived",
        userId: user._id
    });
    assert.equal(invalidStatus.status, 422);
    assert.equal(invalidStatus.body.error.code, "INVALID_COMMENT_STATUS");
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
