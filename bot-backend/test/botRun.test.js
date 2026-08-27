const test = require("node:test");
const assert = require("node:assert/strict");

const BotRun = require("../src/models/BotRun");
const walletService = require("../src/services/billing/walletService");
const { createBotRun } = require("../src/services/botRunService");

const user = {
    _id: "64b000000000000000000010"
};

test("createBotRun rejects insufficient credits before creating BotRun", async (t) => {
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

    await assert.rejects(
        () => createBotRun({
            user,
            videoId: "abcDEF12345",
            prompt: "Reply politely",
            idempotencyKey: "bot-run-key-123456"
        }),
        { code: "INSUFFICIENT_CREDITS", status: 402 }
    );

    assert.equal(createCalled, false);
});

test("createBotRun starts as before when available credits pass preflight", async (t) => {
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
    t.mock.method(walletService, "getAvailableCredits", async () => 1_000_000);
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
