const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const BotRun = require("../src/models/BotRun");
const botRoutes = require("../src/routes/botRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const walletService = require("../src/services/billing/walletService");
const userPromptService = require("../src/services/userPromptService");
const { createBotRun, getBotRunCreditEstimate, resolveBotRunPrompt } = require("../src/services/botRunService");

const user = {
    _id: "64b000000000000000000010",
    tokens: {
        access_token: "access-token"
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
    assert.equal(thrown.details.requiredCredits, 10);
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
    assert.equal(result.requiredCredits, 10);
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
    t.mock.method(BotRun, "create", async (doc) => {
        assert.equal(String(doc.userId), user._id);
        assert.equal(doc.videoId, "abcDEF12345");
        return run;
    });
    t.mock.method(walletService, "getAvailableCredits", async () => 10);
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

test("POST /bot/start returns 402 details and does not create BotRun when credits are insufficient", async (t) => {
    mockPromptNotFound(t);
    let createCalled = false;
    t.mock.method(BotRun, "findOne", async () => null);
    t.mock.method(BotRun, "create", async () => {
        createCalled = true;
        throw new Error("BotRun.create should not be called");
    });
    t.mock.method(walletService, "getAvailableCredits", async () => 9);

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
    assert.equal(response.body.error.details.availableCredits, 9);
    assert.equal(response.body.error.details.requiredCredits, 10);
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
    assert.equal(response.body.cost.requiredCredits, 10);
    assert.equal(response.body.cost.requiredCredits, response.body.cost.estimate.credits);
    assert.equal(response.body.cost.estimate.outputTokens > 0, true);
});

test("GET /bot/runs/:runId disables cache and returns safe top comment error", async (t) => {
    t.mock.method(BotRun, "findById", async () => ({
        _id: "66b000000000000000000001",
        userId: user._id,
        videoId: "abcDEF12345",
        status: "failed",
        processedCount: 2,
        successCount: 0,
        failureCount: 2,
        skippedCount: 0,
        errorCode: "BOT_RUN_NO_REPLIES",
        errorMessage: "Bot run did not create any replies",
        results: [
            {
                commentId: "comment-1",
                status: "failed",
                errorCode: "GEMINI_TIMEOUT",
                errorMessage: "Gemini request timed out"
            },
            {
                commentId: "comment-2",
                status: "failed",
                errorCode: "GEMINI_TIMEOUT",
                errorMessage: "Gemini request timed out"
            }
        ]
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
    assert.equal(response.body.run.topErrorCode, "GEMINI_TIMEOUT");
    assert.equal(response.body.run.topErrorMessage, "Gemini request timed out");
    assert.deepEqual(response.body.run.failedReasonCounts, { GEMINI_TIMEOUT: 2 });
});
