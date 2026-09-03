const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const { google } = require("googleapis");

const BotRun = require("../src/models/BotRun");
const CommentReplyState = require("../src/models/CommentReplyState");
const CommentReplyEditAudit = require("../src/models/CommentReplyEditAudit");
const botRoutes = require("../src/routes/botRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const aiProvider = require("../src/services/ai/aiProvider");
const walletService = require("../src/services/billing/walletService");
const userPromptService = require("../src/services/userPromptService");
const {
    createBotRun,
    createSingleCommentReply,
    generateCommentDraft,
    publishCommentReply,
    editPostedCommentReply,
    retryCommentTask,
    getBotRunCreditEstimate,
    resolveBotRunPrompt
} = require("../src/services/botRunService");
const youtubeService = require("../src/services/youtubeService");
const { toBotRunDto } = require("../src/utils/dto");

const user = {
    _id: "64b000000000000000000010",
    tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expiry_date: Date.now() + 60_000
    }
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
    app.use("/bot", botRoutes);
    app.use(errorHandler);
    return app;
};

const request = async (app, { method = "GET", path, userId, body, headers = {} }) => {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        return await new Promise((resolve, reject) => {
            const rawBody = body === undefined ? undefined : JSON.stringify(body);
            const req = http.request({
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers: {
                    ...(rawBody ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(rawBody) } : {}),
                    ...(userId ? { "X-Test-User": userId } : {}),
                    ...headers
                }
            }, (res) => {
                let responseBody = "";
                res.setEncoding("utf8");
                res.on("data", chunk => {
                    responseBody += chunk;
                });
                res.on("end", () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: responseBody ? JSON.parse(responseBody) : {}
                    });
                });
            });
            req.on("error", reject);
            if (rawBody) req.write(rawBody);
            req.end();
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
};

const mockPromptNotFound = (t) => {
    t.mock.method(userPromptService, "getUserPromptData", async () => {
        const error = new Error("Prompt not found");
        error.code = "PROMPT_NOT_FOUND";
        throw error;
    });
};

const mockYoutubeCommentLookup = (t, {
    commentId = "comment-1",
    videoId = "abcDEF12345",
    commentText = "Great recipe!",
    youtubeReplyId = "reply-1"
} = {}) => {
    t.mock.method(global, "fetch", async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/channels")) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    items: [{
                        id: "channel-1",
                        contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
                    }]
                })
            };
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
            async list(args) {
                assert.equal(args.id, commentId);
                return {
                    data: {
                        items: [{
                            snippet: {
                                videoId,
                                topLevelComment: {
                                    id: commentId,
                                    snippet: { textOriginal: commentText }
                                }
                            }
                        }]
                    }
                };
            }
        },
        comments: {
            async insert(args) {
                assert.equal(args.resource.snippet.parentId, commentId);
                return { data: { id: youtubeReplyId } };
            }
        }
    }));
};

const mockYoutubeReplyEditLookup = (t, {
    commentId = "comment-1",
    videoId = "abcDEF12345",
    commentText = "Great recipe!",
    youtubeReplyId = "reply-1",
    updatedYoutubeReplyId = youtubeReplyId
} = {}) => {
    t.mock.method(global, "fetch", async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/channels")) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    items: [{
                        id: "channel-1",
                        contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
                    }]
                })
            };
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
            async list(args) {
                assert.equal(args.id, commentId);
                return {
                    data: {
                        items: [{
                            snippet: {
                                videoId,
                                topLevelComment: {
                                    id: commentId,
                                    snippet: { textOriginal: commentText }
                                }
                            }
                        }]
                    }
                };
            }
        },
        comments: {
            async update(args) {
                assert.equal(args.part, "snippet");
                assert.equal(args.resource.id, youtubeReplyId);
                assert.equal(args.resource.snippet.textOriginal, "Edited reply with a useful correction.");
                return { data: { id: updatedYoutubeReplyId } };
            }
        }
    }));
};

test("createBotRun rejects insufficient credits before creating BotRun", async (t) => {
    mockPromptNotFound(t);
    let createCalled = false;
    t.mock.method(BotRun, "findOne", async () => null);
    t.mock.method(BotRun, "create", async () => {
        createCalled = true;
        throw new Error("BotRun.create should not be called");
    });
    t.mock.method(walletService, "getAvailableCredits", async ({ userId }) => {
        assert.equal(String(userId), user._id);
        return 0;
    });
    t.mock.method(global, "setImmediate", () => {
        throw new Error("setImmediate should not be called");
    });

    let thrown;
    try {
        await createBotRun({
            user,
            videoId: "abcDEF12345",
            prompt: "Reply politely",
            idempotencyKey: "bot-run-key-123456"
        });
    } catch (error) {
        thrown = error;
    }

    assert.equal(thrown.code, "INSUFFICIENT_CREDITS");
    assert.equal(thrown.status, 402);
    assert.equal(thrown.details.availableCredits, 0);
    assert.equal(thrown.details.requiredCredits, 1);
    assert.equal(thrown.details.requiredCredits, thrown.details.estimate.credits);
    assert.equal(thrown.details.missingCredits, thrown.details.requiredCredits);
    assert.equal(Number.isInteger(thrown.details.estimate.promptTokens), true);
    assert.equal(Number.isInteger(thrown.details.estimate.outputTokens), true);
    assert.equal(createCalled, false);
});

test("getBotRunCreditEstimate returns safe required and available details", async (t) => {
    mockPromptNotFound(t);
    t.mock.method(walletService, "getAvailableCredits", async () => 200);

    const result = await getBotRunCreditEstimate({ user, prompt: "Reply politely" });

    assert.equal(result.availableCredits, 200);
    assert.equal(result.requiredCredits, 1);
    assert.equal(result.requiredCredits, result.estimate.credits);
    assert.equal(result.missingCredits, 0);
    assert.deepEqual(Object.keys(result.estimate).sort(), ["credits", "outputTokens", "promptTokens"]);
});

test("resolveBotRunPrompt regenerates saved theme guidance instead of trusting stale generalPrompt", async (t) => {
    t.mock.method(userPromptService, "getUserPromptData", async () => ({
        channelTheme: "домашню кухню",
        gender: "female",
        generalPrompt: "AI. * Respond"
    }));

    const resolved = await resolveBotRunPrompt({ user, fallbackPrompt: "AI. * Respond" });

    assert.match(resolved, /домашню кухню/);
    assert.match(resolved, /You are a woman/);
    assert.doesNotMatch(resolved, /AI\. \* Respond/);
});

test("createBotRun starts as before when available credits pass preflight", async (t) => {
    mockPromptNotFound(t);
    let scheduled = false;
    const run = {
        _id: "66b000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        idempotencyKey: "bot-run-key-123456",
        status: "queued"
    };

    t.mock.method(BotRun, "findOne", async () => null);
    t.mock.method(global, "fetch", async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/channels")) {
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    items: [{
                        id: "channel-1",
                        contentDetails: { relatedPlaylists: { uploads: "uploads-1" } }
                    }]
                })
            };
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
                return { data: { items: [] } };
            }
        }
    }));
    t.mock.method(CommentReplyState, "exists", async () => false);
    t.mock.method(CommentReplyState, "find", () => ({
        sort() {
            return Promise.resolve([]);
        }
    }));
    t.mock.method(BotRun, "create", async (doc) => {
        assert.equal(String(doc.userId), user._id);
        assert.equal(doc.videoId, "abcDEF12345");
        return run;
    });
    t.mock.method(BotRun, "findById", async () => run);
    t.mock.method(BotRun, "findByIdAndUpdate", async () => run);
    t.mock.method(walletService, "getAvailableCredits", async () => 1);
    t.mock.method(global, "setImmediate", () => {
        scheduled = true;
    });

    const result = await createBotRun({
        user,
        videoId: "abcDEF12345",
        prompt: "Reply politely",
        idempotencyKey: "bot-run-key-123456"
    });

    assert.equal(result.created, true);
    assert.equal(result.run, run);
    assert.equal(scheduled, true);
});

test("createSingleCommentReply rejects already replied comments before creating a duplicate run", async (t) => {
    let createCalled = false;
    let findOneCalls = 0;

    t.mock.method(BotRun, "findOne", (filter) => {
        findOneCalls += 1;
        if (filter.idempotencyKey) {
            return Promise.resolve(null);
        }

        assert.equal(String(filter.userId), user._id);
        assert.equal(filter.videoId, "abcDEF12345");
        assert.equal(filter.results.$elemMatch.commentId, "comment-1");
        assert.equal(filter.results.$elemMatch.status, "replied");
        return {
            sort: async () => ({
                _id: "66b000000000000000000001",
                userId: user._id,
                videoId: "abcDEF12345",
                results: [{ commentId: "comment-1", status: "replied" }]
            })
        };
    });
    t.mock.method(BotRun, "create", async () => {
        createCalled = true;
        throw new Error("BotRun.create should not be called");
    });
    t.mock.method(CommentReplyState, "findOne", async () => null);

    await assert.rejects(
        () => createSingleCommentReply({
            user,
            videoId: "abcDEF12345",
            commentId: "comment-1",
            prompt: "Reply politely",
            idempotencyKey: "single-comment-key-123"
        }),
        { code: "COMMENT_ALREADY_REPLIED", status: 409 }
    );

    assert.equal(findOneCalls, 2);
    assert.equal(createCalled, false);
});

test("generateCommentDraft creates an AI draft and records comment state", async (t) => {
    mockPromptNotFound(t);
    mockYoutubeCommentLookup(t);
    let runCreated = false;
    let stateUpdated = false;

    t.mock.method(CommentReplyState, "findOne", async () => null);
    t.mock.method(BotRun, "findOne", (filter) => {
        if (filter.idempotencyKey) return Promise.resolve(null);
        return { sort: async () => null };
    });
    t.mock.method(walletService, "getAvailableCredits", async () => 1);
    t.mock.method(BotRun, "create", async (doc) => {
        runCreated = true;
        assert.equal(doc.mode, "single-comment");
        assert.equal(doc.status, "running");
        return { _id: "66b000000000000000000001", ...doc };
    });
    t.mock.method(aiProvider, "generateReply", async (args) => {
        assert.equal(args.commentId, "comment-1");
        assert.equal(args.deferBilling, undefined);
        return {
            text: "Thanks for the kind note about the recipe.",
            latencyMs: 123,
            attemptCount: 1
        };
    });
    t.mock.method(CommentReplyState, "findOneAndUpdate", async (filter, update) => {
        stateUpdated = true;
        assert.equal(filter.commentId, "comment-1");
        assert.equal(update.$set.status, "drafted");
        assert.equal(update.$set.draftReplyText, "Thanks for the kind note about the recipe.");
        return {
            _id: "state-1",
            userId: user._id,
            videoId: "abcDEF12345",
            commentId: "comment-1",
            ...update.$set,
            updatedAt: new Date("2026-01-01T00:00:00Z")
        };
    });
    t.mock.method(BotRun, "findByIdAndUpdate", async (runId, update) => ({
        _id: runId,
        userId: user._id,
        videoId: "abcDEF12345",
        mode: "single-comment",
        status: update.status,
        processedCount: update.processedCount,
        results: update.results
    }));

    const result = await generateCommentDraft({
        user,
        videoId: "abcDEF12345",
        commentId: "comment-1",
        prompt: "Reply politely",
        idempotencyKey: "draft-comment-key-123"
    });

    assert.equal(runCreated, true);
    assert.equal(stateUpdated, true);
    assert.equal(result.created, true);
    assert.equal(result.result.status, "drafted");
    assert.equal(result.result.draftReplyText, "Thanks for the kind note about the recipe.");
});

test("publishCommentReply posts manual text without invoking AI or wallet billing", async (t) => {
    mockYoutubeCommentLookup(t, { youtubeReplyId: "reply-123" });
    let runCreated = false;
    let stateUpdated = false;

    t.mock.method(CommentReplyState, "findOne", async () => null);
    t.mock.method(BotRun, "findOne", (filter) => {
        if (filter.idempotencyKey) return Promise.resolve(null);
        return { sort: async () => null };
    });
    t.mock.method(aiProvider, "generateReply", async () => {
        throw new Error("AI should not be called when publishing a manual reply");
    });
    t.mock.method(walletService, "getAvailableCredits", async () => {
        throw new Error("Wallet should not be checked when publishing a manual reply");
    });
    t.mock.method(BotRun, "create", async (doc) => {
        runCreated = true;
        assert.equal(doc.status, "completed");
        assert.equal(doc.successCount, 1);
        assert.equal(doc.results[0].replyTextSnapshot, "Manual reply with a useful detail.");
        return { _id: "66b000000000000000000002", ...doc };
    });
    t.mock.method(CommentReplyState, "findOneAndUpdate", async (filter, update) => {
        stateUpdated = true;
        assert.equal(filter.commentId, "comment-1");
        assert.equal(update.$set.status, "replied");
        assert.equal(update.$set.draftReplyText, null);
        assert.equal(update.$set.postedReplyTextSnapshot, "Manual reply with a useful detail.");
        assert.equal(update.$set.youtubeReplyId, "reply-123");
        return {
            _id: "state-1",
            userId: user._id,
            videoId: "abcDEF12345",
            commentId: "comment-1",
            ...update.$set,
            updatedAt: new Date("2026-01-01T00:00:00Z")
        };
    });

    const result = await publishCommentReply({
        user,
        videoId: "abcDEF12345",
        commentId: "comment-1",
        replyText: "Manual reply with a useful detail.",
        source: "manual",
        idempotencyKey: "publish-comment-key-123"
    });

    assert.equal(runCreated, true);
    assert.equal(stateUpdated, true);
    assert.equal(result.created, true);
    assert.equal(result.result.status, "replied");
    assert.equal(result.result.youtubeReplyId, "reply-123");
});

test("editPostedCommentReply updates a stored YouTube reply snapshot and writes audit", async (t) => {
    mockYoutubeReplyEditLookup(t);
    let updateOneCalled = false;
    let auditCreated = false;
    let aiCalled = false;
    let walletCalled = false;
    const state = {
        _id: "66c000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        commentId: "comment-1",
        status: "replied",
        taskType: "bulk-reply",
        postedReplyTextSnapshot: "Original posted reply.",
        youtubeReplyId: "reply-1",
        botRunId: "66b000000000000000000001",
        generatedByAi: true,
        editCount: 0,
        async save() {}
    };

    t.mock.method(CommentReplyEditAudit, "findOne", async () => null);
    t.mock.method(CommentReplyState, "findOne", async (filter) => {
        assert.equal(String(filter._id), state._id);
        assert.equal(String(filter.userId), user._id);
        assert.equal(filter.videoId, "abcDEF12345");
        assert.equal(filter.commentId, "comment-1");
        return state;
    });
    t.mock.method(BotRun, "updateOne", async (filter, update) => {
        updateOneCalled = true;
        assert.equal(String(filter._id), state.botRunId);
        assert.equal(filter["results.commentId"], "comment-1");
        assert.equal(update.$set["results.$.replyTextSnapshot"], "Edited reply with a useful correction.");
        assert.equal(update.$set["results.$.youtubeReplyId"], "reply-1");
        return {};
    });
    t.mock.method(CommentReplyEditAudit, "create", async (doc) => {
        auditCreated = true;
        assert.equal(String(doc.userId), user._id);
        assert.equal(doc.action, "BOT_REPLY_EDITED");
        assert.equal(doc.beforeTextSnapshot, "Original posted reply.");
        assert.equal(doc.afterTextSnapshot, "Edited reply with a useful correction.");
        assert.equal(doc.idempotencyKey, "edit-comment-key-1234");
        return { _id: "audit-1", ...doc };
    });
    t.mock.method(aiProvider, "generateReply", async () => {
        aiCalled = true;
    });
    t.mock.method(walletService, "getAvailableCredits", async () => {
        walletCalled = true;
    });

    const result = await editPostedCommentReply({
        user,
        videoId: "abcDEF12345",
        commentId: "comment-1",
        taskId: "66c000000000000000000001",
        replyText: "Edited reply with a useful correction.",
        idempotencyKey: "edit-comment-key-1234"
    });

    assert.equal(result.edited, true);
    assert.equal(result.state.postedReplyTextSnapshot, "Edited reply with a useful correction.");
    assert.equal(result.state.editCount, 1);
    assert.equal(updateOneCalled, true);
    assert.equal(auditCreated, true);
    assert.equal(aiCalled, false);
    assert.equal(walletCalled, false);
});

test("editPostedCommentReply is idempotent after a successful edit", async (t) => {
    let youtubeUpdateCalled = false;
    const state = {
        _id: "66c000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        commentId: "comment-1",
        status: "replied",
        postedReplyTextSnapshot: "Already edited reply.",
        youtubeReplyId: "reply-1",
        editCount: 1
    };

    t.mock.method(CommentReplyEditAudit, "findOne", async () => ({
        replyStateId: state._id,
        userId: user._id,
        idempotencyKey: "edit-comment-key-1234"
    }));
    t.mock.method(CommentReplyState, "findOne", async (filter) => {
        assert.equal(String(filter._id), state._id);
        assert.equal(String(filter.userId), user._id);
        return state;
    });
    t.mock.method(google, "youtube", () => ({
        comments: {
            async update() {
                youtubeUpdateCalled = true;
            }
        }
    }));

    const result = await editPostedCommentReply({
        user,
        videoId: "abcDEF12345",
        commentId: "comment-1",
        taskId: "66c000000000000000000001",
        replyText: "Already edited reply.",
        idempotencyKey: "edit-comment-key-1234"
    });

    assert.equal(result.edited, false);
    assert.equal(result.state, state);
    assert.equal(youtubeUpdateCalled, false);
});

test("editPostedCommentReply rejects non-owned or non-editable reply records", async (t) => {
    mockYoutubeReplyEditLookup(t);
    t.mock.method(CommentReplyEditAudit, "findOne", async () => null);
    t.mock.method(CommentReplyState, "findOne", async () => null);

    await assert.rejects(
        () => editPostedCommentReply({
            user,
            videoId: "abcDEF12345",
            commentId: "comment-1",
            taskId: "66c000000000000000000002",
            replyText: "Edited reply with a useful correction.",
            idempotencyKey: "edit-comment-key-1234"
        }),
        { code: "COMMENT_REPLY_NOT_FOUND", status: 404 }
    );
});

test("editPostedCommentReply rejects replied records without a stored YouTube reply id", async (t) => {
    mockYoutubeReplyEditLookup(t);
    t.mock.method(CommentReplyEditAudit, "findOne", async () => null);
    t.mock.method(CommentReplyState, "findOne", async () => ({
        _id: "66c000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        commentId: "comment-1",
        status: "replied",
        postedReplyTextSnapshot: "Old reply without ID.",
        youtubeReplyId: null
    }));

    await assert.rejects(
        () => editPostedCommentReply({
            user,
            videoId: "abcDEF12345",
            commentId: "comment-1",
            taskId: "66c000000000000000000001",
            replyText: "Edited reply with a useful correction.",
            idempotencyKey: "edit-comment-key-1234"
        }),
        { code: "YOUTUBE_REPLY_ID_MISSING", status: 422 }
    );
});

test("editYoutubeReply maps YouTube permission and missing reply errors safely", async (t) => {
    let mode = "forbidden";
    t.mock.method(google, "youtube", () => ({
        comments: {
            async update() {
                if (mode === "forbidden") {
                    const error = new Error("Forbidden");
                    error.response = {
                        status: 403,
                        data: { error: { errors: [{ reason: "forbidden" }] } }
                    };
                    throw error;
                }

                const error = new Error("Not found");
                error.response = {
                    status: 404,
                    data: { error: { errors: [{ reason: "commentNotFound" }] } }
                };
                throw error;
            }
        }
    }));

    await assert.rejects(
        () => youtubeService.editYoutubeReply("access-token", "reply-1", "Edited reply"),
        { code: "YOUTUBE_REPLY_EDIT_FORBIDDEN", status: 403 }
    );

    mode = "not-found";

    await assert.rejects(
        () => youtubeService.editYoutubeReply("access-token", "reply-1", "Edited reply"),
        { code: "YOUTUBE_REPLY_NOT_FOUND", status: 404 }
    );
});

test("retryCommentTask queues a failed task and resumes its run", async (t) => {
    let saved = false;
    let scheduled = false;
    const task = {
        _id: "66c000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        commentId: "comment-1",
        taskType: "bulk-reply",
        status: "failed",
        botRunId: "66b000000000000000000001",
        lastErrorCode: "GEMINI_TIMEOUT",
        lastErrorMessage: "Gemini request timed out",
        async save() {
            saved = true;
        }
    };
    t.mock.method(CommentReplyState, "findOne", async () => task);
    t.mock.method(BotRun, "findById", async () => ({
        _id: "66b000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        status: "partial"
    }));
    t.mock.method(BotRun, "findByIdAndUpdate", async (runId, update) => {
        assert.equal(String(runId), "66b000000000000000000001");
        assert.equal(update.status, "queued");
        return { _id: runId, userId: user._id, videoId: "abcDEF12345", status: "queued" };
    });
    t.mock.method(global, "setImmediate", () => {
        scheduled = true;
    });

    const result = await retryCommentTask({
        user,
        taskId: "66c000000000000000000001",
        idempotencyKey: "retry-comment-key-123"
    });

    assert.equal(saved, true);
    assert.equal(scheduled, true);
    assert.equal(task.status, "queued");
    assert.equal(task.lastErrorCode, null);
    assert.equal(task.idempotencyKey, "retry-comment-key-123");
    assert.equal(result.run.status, "queued");
});

test("retryCommentTask rejects already posted tasks", async (t) => {
    t.mock.method(CommentReplyState, "findOne", async () => ({
        _id: "66c000000000000000000001",
        userId: user._id,
        taskType: "bulk-reply",
        status: "replied"
    }));

    await assert.rejects(
        () => retryCommentTask({
            user,
            taskId: "66c000000000000000000001",
            idempotencyKey: "retry-comment-key-123"
        }),
        { code: "COMMENT_ALREADY_REPLIED", status: 409 }
    );
});

test("POST /bot/start returns 402 details and does not create BotRun when credits are insufficient", async (t) => {
    mockPromptNotFound(t);
    let createCalled = false;
    t.mock.method(BotRun, "findOne", async () => null);
    t.mock.method(BotRun, "create", async () => {
        createCalled = true;
        throw new Error("BotRun.create should not be called");
    });
    t.mock.method(walletService, "getAvailableCredits", async () => 0);

    const response = await request(createApp(), {
        method: "POST",
        path: "/bot/start",
        userId: user._id,
        headers: { "X-CSRF-Protection": "1" },
        body: {
            videoId: "abcDEF12345",
            prompt: "Reply politely",
            idempotencyKey: "bot-run-key-123456"
        }
    });

    assert.equal(response.status, 402);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, "INSUFFICIENT_CREDITS");
    assert.equal(response.body.error.details.availableCredits, 0);
    assert.equal(response.body.error.details.requiredCredits, 1);
    assert.equal(response.body.error.details.requiredCredits, response.body.error.details.estimate.credits);
    assert.equal(createCalled, false);
});

test("POST /bot/cost-estimate returns backend-owned cost metadata", async (t) => {
    mockPromptNotFound(t);
    t.mock.method(walletService, "getAvailableCredits", async () => 200);

    const response = await request(createApp(), {
        method: "POST",
        path: "/bot/cost-estimate",
        userId: user._id,
        body: { prompt: "Reply politely" }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.cost.availableCredits, 200);
    assert.equal(response.body.cost.requiredCredits, 1);
    assert.equal(response.body.cost.requiredCredits, response.body.cost.estimate.credits);
    assert.equal(response.body.cost.estimate.outputTokens > 0, true);
});

test("POST /bot/comments/:commentId/reply requires auth, write header, and valid identifiers", async () => {
    const app = createApp();

    const unauthenticated = await request(app, {
        method: "POST",
        path: "/bot/comments/comment-1/reply",
        body: {
            videoId: "abcDEF12345",
            idempotencyKey: "single-comment-key-123"
        }
    });
    assert.equal(unauthenticated.status, 401);

    const missingHeader = await request(app, {
        method: "POST",
        path: "/bot/comments/comment-1/reply",
        userId: user._id,
        body: {
            videoId: "abcDEF12345",
            idempotencyKey: "single-comment-key-123"
        }
    });
    assert.equal(missingHeader.status, 403);
    assert.equal(missingHeader.body.error.code, "CSRF_HEADER_REQUIRED");

    const invalidComment = await request(app, {
        method: "POST",
        path: "/bot/comments/bad%20comment/reply",
        userId: user._id,
        headers: { "X-CSRF-Protection": "1" },
        body: {
            videoId: "abcDEF12345",
            idempotencyKey: "single-comment-key-123"
        }
    });
    assert.equal(invalidComment.status, 422);
    assert.equal(invalidComment.body.error.code, "INVALID_COMMENT_ID");

    const invalidVideo = await request(app, {
        method: "POST",
        path: "/bot/comments/comment-1/reply",
        userId: user._id,
        headers: { "X-CSRF-Protection": "1" },
        body: {
            videoId: "short",
            idempotencyKey: "single-comment-key-123"
        }
    });
    assert.equal(invalidVideo.status, 422);
    assert.equal(invalidVideo.body.error.code, "INVALID_VIDEO_ID");
});

test("comment draft and publish endpoints require auth and write header", async () => {
    const app = createApp();
    const endpoints = [
        { method: "POST", path: "/bot/comments/comment-1/draft", body: { videoId: "abcDEF12345", idempotencyKey: "draft-comment-key-123" } },
        { method: "PUT", path: "/bot/comments/comment-1/draft", body: { videoId: "abcDEF12345", draftReplyText: "Draft reply" } },
        { method: "DELETE", path: "/bot/comments/comment-1/draft", body: { videoId: "abcDEF12345" } },
        { method: "POST", path: "/bot/comments/comment-1/publish", body: { videoId: "abcDEF12345", replyText: "Manual reply", source: "manual", idempotencyKey: "publish-comment-key-123" } },
        { method: "PUT", path: "/bot/comments/comment-1/reply", body: { videoId: "abcDEF12345", taskId: "66c000000000000000000001", replyText: "Edited reply", idempotencyKey: "edit-comment-key-1234" } }
    ];

    for (const endpoint of endpoints) {
        const unauthenticated = await request(app, endpoint);
        assert.equal(unauthenticated.status, 401);

        const missingHeader = await request(app, {
            ...endpoint,
            userId: user._id
        });
        assert.equal(missingHeader.status, 403);
        assert.equal(missingHeader.body.error.code, "CSRF_HEADER_REQUIRED");
    }
});

test("GET /bot/runs/:runId disables cache and returns safe dominant comment error", async (t) => {
    t.mock.method(BotRun, "findById", async () => ({
        _id: "66b000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        status: "failed",
        processedCount: 3,
        successCount: 0,
        failureCount: 3,
        skippedCount: 0,
        errorCode: "BOT_RUN_NO_REPLIES",
        errorMessage: "Bot run did not create any replies",
        results: [
            {
                commentId: "comment-1",
                status: "failed",
                errorCode: "GEMINI_RATE_LIMIT",
                errorMessage: "Gemini generation failed"
            },
            {
                commentId: "comment-2",
                status: "failed",
                errorCode: "GEMINI_RATE_LIMIT",
                errorMessage: "Gemini generation failed"
            },
            {
                commentId: "comment-3",
                status: "failed",
                errorCode: "GEMINI_PROVIDER_ERROR",
                errorMessage: "Gemini generation failed"
            }
        ]
    }));
    t.mock.method(CommentReplyState, "find", () => ({
        sort() {
            return {
                lean: async () => []
            };
        }
    }));

    const response = await request(createApp(), {
        path: "/bot/runs/66b000000000000000000001",
        userId: user._id,
        headers: { "If-None-Match": "\"stale-etag\"" }
    });

    assert.equal(response.status, 200);
    assert.match(response.headers["cache-control"], /no-store/);
    assert.equal(response.headers.pragma, "no-cache");
    assert.equal(response.headers.expires, "0");
    assert.equal(response.body.run.errorCode, "BOT_RUN_NO_REPLIES");
    assert.equal(response.body.run.topErrorCode, "GEMINI_RATE_LIMIT");
    assert.equal(response.body.run.topErrorMessage, "Gemini generation failed");
    assert.deepEqual(response.body.run.failedReasonCounts, { GEMINI_RATE_LIMIT: 2, GEMINI_PROVIDER_ERROR: 1 });
    assert.deepEqual(response.body.run.results.map(result => result.status), ["failed", "failed", "failed"]);
    assert.equal(response.body.run.results[0].commentTextSnapshot, null);
    assert.equal(response.body.run.results[0].replyTextSnapshot, null);
});

test("toBotRunDto exposes safe result summaries and handles legacy runs without snapshots", () => {
    const dto = toBotRunDto({
        _id: "66b000000000000000000001",
        videoId: "abcDEF12345",
        status: "partial",
        processedCount: 2,
        successCount: 1,
        failureCount: 1,
        skippedCount: 0,
        results: [
            {
                commentId: "comment-1",
                status: "replied",
                commentTextSnapshot: "Viewer asked about sauce.",
                replyTextSnapshot: "Thanks, the sauce works best when stirred slowly.",
                aiLatencyMs: 123,
                youtubeInsertLatencyMs: 45,
                attemptCount: 1
            },
            {
                commentId: "comment-2",
                status: "failed",
                errorCode: "GEMINI_RATE_LIMIT",
                errorMessage: "Gemini generation failed"
            }
        ]
    });

    assert.equal(dto.results.length, 2);
    assert.deepEqual(dto.results[0], {
        taskId: null,
        commentId: "comment-1",
        status: "replied",
        runId: null,
        errorCode: null,
        errorMessage: null,
        commentTextSnapshot: "Viewer asked about sauce.",
        replyTextSnapshot: "Thanks, the sauce works best when stirred slowly.",
        draftReplyText: null,
        youtubeReplyId: null,
        canEditPostedReply: false,
        editDisabledReason: "MISSING_YOUTUBE_REPLY_ID",
        editCount: 0,
        lastEditedAt: null,
        generatedByAi: null,
        aiLatencyMs: 123,
        youtubeInsertLatencyMs: 45,
        attemptCount: 1,
        createdAt: null,
        updatedAt: null
    });
    assert.equal(dto.results[1].commentTextSnapshot, null);
    assert.equal(dto.results[1].replyTextSnapshot, null);
    assert.equal(dto.topErrorCode, "GEMINI_RATE_LIMIT");
});
