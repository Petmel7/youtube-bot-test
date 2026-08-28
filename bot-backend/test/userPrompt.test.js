const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const userPromptRoutes = require("../src/routes/userPromptRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const UserPrompt = require("../src/models/UserPrompt");

const userId = "64d000000000000000000101";

const createApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const requestUserId = req.get("X-Test-User");
        req.isAuthenticated = () => Boolean(requestUserId);
        if (requestUserId) req.user = { _id: requestUserId, id: requestUserId };
        next();
    });
    app.use("/user-prompt", userPromptRoutes);
    app.use(errorHandler);
    return app;
};

const request = async (app, { path = "/user-prompt", userId: requestUserId } = {}) => {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            headers: requestUserId ? { "X-Test-User": requestUserId } : {}
        });
        return { status: response.status, headers: response.headers, body: await response.json() };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
};

test("GET /user-prompt returns 200 with null prompt for authenticated first-time user", async (t) => {
    t.mock.method(UserPrompt, "findOne", async (filter) => {
        assert.equal(String(filter.userId), userId);
        return null;
    });

    const response = await request(createApp(), { userId });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("expires"), "0");
    assert.deepEqual(response.body, { success: true, prompt: null });
});

test("GET /user-prompt returns prompt DTO for authenticated user with saved prompt", async (t) => {
    const createdAt = new Date("2026-08-21T10:00:00.000Z");
    const updatedAt = new Date("2026-08-21T10:05:00.000Z");
    t.mock.method(UserPrompt, "findOne", async (filter) => {
        assert.equal(String(filter.userId), userId);
        return {
            _id: "64d000000000000000000102",
            channelTheme: "education",
            gender: "female",
            generalPrompt: "Generated prompt",
            createdAt,
            updatedAt
        };
    });

    const response = await request(createApp(), { userId });

    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.deepEqual(response.body.prompt, {
        id: "64d000000000000000000102",
        channelTheme: "education",
        gender: "female",
        generalPrompt: "Generated prompt",
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString()
    });
});

test("GET /user-prompt still rejects unauthenticated requests", async () => {
    const response = await request(createApp());

    assert.equal(response.status, 401);
    assert.equal(response.body.success, false);
    assert.equal(response.body.error.code, "UNAUTHENTICATED");
});
