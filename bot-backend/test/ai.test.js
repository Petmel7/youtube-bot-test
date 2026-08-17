const test = require("node:test");
const assert = require("node:assert/strict");

const { createAiProvider } = require("../src/services/ai/aiProvider");
const { buildOperationKey, recordAiUsage } = require("../src/services/ai/aiUsageService");
const {
    createGeminiProvider,
    normalizeUsage
} = require("../src/services/ai/providers/geminiProvider");

const createFakeGenAI = ({ text = " Thanks! ", usageMetadata, error }) => ({
    getGenerativeModel(config) {
        return {
            config,
            async generateContent(prompt) {
                if (error) throw error;

                return {
                    prompt,
                    response: {
                        usageMetadata,
                        async text() {
                            return text;
                        }
                    }
                };
            }
        };
    }
});

const createFakeWallet = (events = []) => ({
    async reserveCredits(input) {
        events.push({ type: "reserve", input });
        return { created: true };
    },
    async finalizeCharge(input) {
        events.push({ type: "finalize", input });
        return {};
    },
    async releaseReservation(input) {
        events.push({ type: "release", input });
        return {};
    }
});

test("Gemini provider returns text and normalized model/provider usage", async () => {
    const provider = createGeminiProvider({
        genAI: createFakeGenAI({
            usageMetadata: {
                promptTokenCount: 12,
                candidatesTokenCount: 5,
                totalTokenCount: 17
            }
        }),
        modelName: "gemini-test",
        timeoutMs: 1000,
        retryCount: 0
    });

    const result = await provider.generateReply({
        comment: "Great video",
        prompt: "Be friendly"
    });

    assert.equal(result.text, "Thanks!");
    assert.equal(result.provider, "gemini");
    assert.equal(result.model, "gemini-test");
    assert.deepEqual(result.usage, {
        promptTokens: 12,
        outputTokens: 5,
        totalTokens: 17
    });
    assert.equal(result.success, true);
    assert.equal(typeof result.latencyMs, "number");
});

test("Gemini provider does not fabricate missing token usage", async () => {
    assert.deepEqual(normalizeUsage(), {
        promptTokens: null,
        outputTokens: null,
        totalTokens: null
    });

    const provider = createGeminiProvider({
        genAI: createFakeGenAI({ usageMetadata: undefined }),
        modelName: "gemini-test",
        timeoutMs: 1000,
        retryCount: 0
    });

    const result = await provider.generateReply({
        comment: "Great video",
        prompt: "Be friendly"
    });

    assert.deepEqual(result.usage, {
        promptTokens: null,
        outputTokens: null,
        totalTokens: null
    });
});

test("Gemini provider exposes normalized failure information", async () => {
    const provider = createGeminiProvider({
        genAI: createFakeGenAI({ error: { status: 429 } }),
        modelName: "gemini-test",
        timeoutMs: 1000,
        retryCount: 0
    });

    await assert.rejects(
        () => provider.generateReply({ comment: "Great video", prompt: "Be friendly" }),
        (error) => {
            assert.equal(error.code, "GEMINI_PROVIDER_ERROR");
            assert.equal(error.providerErrorCode, "GEMINI_RATE_LIMIT");
            return true;
        }
    );
});

test("AiProvider records usage after a successful operation", async () => {
    const records = [];
    const statusUpdates = [];
    const walletEvents = [];
    const provider = createAiProvider({
        provider: {
            provider: "gemini",
            model: "gemini-test",
            async generateReply() {
                return {
                    text: "Thanks!",
                    provider: "gemini",
                    model: "gemini-test",
                    usage: {
                        promptTokens: 1,
                        outputTokens: 2,
                        totalTokens: 3
                    },
                    latencyMs: 4,
                    success: true
                };
            }
        },
        async usageRecorder(operation, result) {
            records.push({ operation, result });
        },
        async usageStatusUpdater(operationKey, update) {
            statusUpdates.push({ operationKey, update });
        },
        wallet: createFakeWallet(walletEvents),
        estimateCost: () => ({ promptTokens: 10, outputTokens: 10, credits: 50 }),
        calculateActualCost: () => ({ promptTokens: 1, outputTokens: 2, totalTokens: 3, credits: 9 })
    });

    const result = await provider.generateReply({
        userId: "64b000000000000000000000",
        runId: "64b000000000000000000001",
        videoId: "abcDEF123_-",
        commentId: "comment-1",
        comment: "Great video",
        prompt: "Be friendly"
    });

    assert.equal(result.text, "Thanks!");
    assert.equal(records.length, 1);
    assert.equal(records[0].operation.operationKey, result.operationKey);
    assert.equal(records[0].operation.commentId, "comment-1");
    assert.equal(records[0].result.usage.totalTokens, 3);
    assert.equal(records[0].result.billingStatus, "USAGE_RECORDED");
    assert.equal(records[0].result.reservedCredits, 50);
    assert.equal(records[0].result.actualCredits, 9);
    assert.deepEqual(walletEvents.map(event => event.type), ["reserve", "finalize"]);
    assert.equal(statusUpdates[0].update.billingStatus, "CHARGE_FINALIZED");
});

test("AiProvider records failed operations and preserves error propagation", async () => {
    const records = [];
    const walletEvents = [];
    const provider = createAiProvider({
        provider: {
            provider: "gemini",
            model: "gemini-test",
            async generateReply() {
                const error = new Error("failed");
                error.code = "GEMINI_TIMEOUT";
                error.isOperational = true;
                throw error;
            }
        },
        async usageRecorder(operation, result) {
            records.push({ operation, result });
        },
        wallet: createFakeWallet(walletEvents),
        estimateCost: () => ({ promptTokens: 10, outputTokens: 10, credits: 50 })
    });

    await assert.rejects(
        () => provider.generateReply({
            userId: "64b000000000000000000000",
            runId: "64b000000000000000000001",
            videoId: "abcDEF123_-",
            commentId: "comment-1",
            comment: "Great video",
            prompt: "Be friendly"
        }),
        { code: "GEMINI_TIMEOUT" }
    );

    assert.equal(records.length, 1);
    assert.equal(records[0].result.success, false);
    assert.equal(records[0].result.errorCode, "GEMINI_TIMEOUT");
    assert.equal(records[0].result.billingStatus, "PROVIDER_FAILED");
    assert.deepEqual(walletEvents.map(event => event.type), ["reserve", "release"]);
});

test("AiProvider resumes provider call for an active existing reservation", async () => {
    let providerCalls = 0;
    const walletEvents = [];
    const provider = createAiProvider({
        provider: {
            provider: "gemini",
            model: "gemini-test",
            async generateReply() {
                providerCalls++;
                return {
                    text: "Thanks!",
                    provider: "gemini",
                    model: "gemini-test",
                    usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 },
                    latencyMs: 1,
                    success: true
                };
            }
        },
        async usageRecorder() {},
        async usageStatusUpdater() {},
        wallet: {
            async reserveCredits(input) {
                walletEvents.push({ type: "reserve", input });
                return { created: false, settled: false, transaction: { idempotencyKey: input.idempotencyKey } };
            },
            async finalizeCharge(input) {
                walletEvents.push({ type: "finalize", input });
                return {};
            }
        },
        async usageReader() {
            return null;
        },
        estimateCost: () => ({ promptTokens: 1, outputTokens: 1, credits: 5 })
    });

    const result = await provider.generateReply({
        userId: "64b000000000000000000000",
        runId: "64b000000000000000000001",
        videoId: "abcDEF123_-",
        commentId: "comment-1",
        comment: "Great video",
        prompt: "Be friendly"
    });

    assert.equal(result.text, "Thanks!");
    assert.equal(providerCalls, 1);
    assert.deepEqual(walletEvents.map(event => event.type), ["reserve", "finalize"]);
});

test("AiProvider finalizes recorded usage for an existing reservation without another provider call", async () => {
    let providerCalls = 0;
    const walletEvents = [];
    const statusUpdates = [];
    const provider = createAiProvider({
        provider: {
            provider: "gemini",
            model: "gemini-test",
            async generateReply() {
                providerCalls++;
                return {
                    text: "Thanks!",
                    provider: "gemini",
                    model: "gemini-test",
                    usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 },
                    latencyMs: 1,
                    success: true
                };
            }
        },
        async usageReader() {
            return {
                billingStatus: "USAGE_RECORDED",
                success: true,
                provider: "gemini",
                model: "gemini-test",
                promptTokens: 1,
                outputTokens: 2,
                totalTokens: 3
            };
        },
        async usageStatusUpdater(operationKey, update) {
            statusUpdates.push({ operationKey, update });
        },
        wallet: {
            async reserveCredits(input) {
                walletEvents.push({ type: "reserve", input });
                return { created: false, settled: false, transaction: { idempotencyKey: input.idempotencyKey } };
            },
            async finalizeCharge(input) {
                walletEvents.push({ type: "finalize", input });
                return {};
            }
        },
        estimateCost: () => ({ promptTokens: 1, outputTokens: 1, credits: 5 }),
        calculateActualCost: () => ({ promptTokens: 1, outputTokens: 2, totalTokens: 3, credits: 7 })
    });

    await assert.rejects(() => provider.generateReply({
        userId: "64b000000000000000000000",
        runId: "64b000000000000000000001",
        videoId: "abcDEF123_-",
        commentId: "comment-1",
        comment: "Great video",
        prompt: "Be friendly"
    }), { code: "AI_OPERATION_ALREADY_FINALIZED" });

    assert.equal(providerCalls, 0);
    assert.deepEqual(walletEvents.map(event => event.type), ["reserve", "finalize"]);
    assert.equal(statusUpdates[0].update.billingStatus, "CHARGE_FINALIZED");
});

test("AiProvider releases an active reservation when provider failure was already recorded", async () => {
    let providerCalls = 0;
    const walletEvents = [];
    const statusUpdates = [];
    const provider = createAiProvider({
        provider: {
            provider: "gemini",
            model: "gemini-test",
            async generateReply() {
                providerCalls++;
                throw new Error("should not be called");
            }
        },
        async usageReader() {
            return {
                billingStatus: "PROVIDER_FAILED",
                success: false,
                errorCode: "GEMINI_TIMEOUT"
            };
        },
        async usageStatusUpdater(operationKey, update) {
            statusUpdates.push({ operationKey, update });
        },
        wallet: {
            async reserveCredits(input) {
                walletEvents.push({ type: "reserve", input });
                return { created: false, settled: false, transaction: { idempotencyKey: input.idempotencyKey } };
            },
            async releaseReservation(input) {
                walletEvents.push({ type: "release", input });
                return {};
            }
        },
        estimateCost: () => ({ promptTokens: 1, outputTokens: 1, credits: 5 })
    });

    await assert.rejects(() => provider.generateReply({
        userId: "64b000000000000000000000",
        runId: "64b000000000000000000001",
        videoId: "abcDEF123_-",
        commentId: "comment-1",
        comment: "Great video",
        prompt: "Be friendly"
    }), { code: "AI_OPERATION_ALREADY_FINALIZED" });

    assert.equal(providerCalls, 0);
    assert.deepEqual(walletEvents.map(event => event.type), ["reserve", "release"]);
    assert.equal(statusUpdates[0].update.billingStatus, "RESERVATION_RELEASED");
});

test("AiProvider reconciles usage status when wallet finalization already exists", async () => {
    let providerCalls = 0;
    const statusUpdates = [];
    const provider = createAiProvider({
        provider: {
            provider: "gemini",
            model: "gemini-test",
            async generateReply() {
                providerCalls++;
                throw new Error("should not be called");
            }
        },
        async usageReader() {
            return null;
        },
        async usageStatusUpdater(operationKey, update) {
            statusUpdates.push({ operationKey, update });
        },
        wallet: {
            async reserveCredits(input) {
                return {
                    created: false,
                    settled: true,
                    transaction: { idempotencyKey: input.idempotencyKey },
                    settlement: { type: "DEBIT", reservationKey: input.idempotencyKey }
                };
            }
        },
        estimateCost: () => ({ promptTokens: 1, outputTokens: 1, credits: 5 })
    });

    await assert.rejects(() => provider.generateReply({
        userId: "64b000000000000000000000",
        runId: "64b000000000000000000001",
        videoId: "abcDEF123_-",
        commentId: "comment-1",
        comment: "Great video",
        prompt: "Be friendly"
    }), { code: "AI_OPERATION_ALREADY_FINALIZED" });

    assert.equal(providerCalls, 0);
    assert.equal(statusUpdates[0].update.billingStatus, "CHARGE_FINALIZED");
});

test("AiProvider releases reservation when usage persistence fails after provider success", async () => {
    const walletEvents = [];
    const provider = createAiProvider({
        provider: {
            provider: "gemini",
            model: "gemini-test",
            async generateReply() {
                return {
                    text: "Thanks!",
                    provider: "gemini",
                    model: "gemini-test",
                    usage: { promptTokens: 1, outputTokens: 1, totalTokens: 2 },
                    latencyMs: 1,
                    success: true
                };
            }
        },
        async usageRecorder() {
            throw new Error("write failed");
        },
        wallet: createFakeWallet(walletEvents),
        estimateCost: () => ({ promptTokens: 1, outputTokens: 1, credits: 5 }),
        calculateActualCost: () => ({ promptTokens: 1, outputTokens: 1, totalTokens: 2, credits: 3 })
    });

    await assert.rejects(() => provider.generateReply({
        userId: "64b000000000000000000000",
        runId: "64b000000000000000000001",
        videoId: "abcDEF123_-",
        commentId: "comment-1",
        comment: "Great video",
        prompt: "Be friendly"
    }), { code: "ACCOUNTING_ERROR" });

    assert.deepEqual(walletEvents.map(event => event.type), ["reserve", "release"]);
});

test("AI usage operationKey is deterministic and duplicate inserts are prevented", async () => {
    const operation = {
        userId: "64b000000000000000000000",
        runId: "64b000000000000000000001",
        commentId: "comment-1",
        provider: "gemini",
        model: "gemini-test"
    };
    const key = buildOperationKey(operation);

    assert.equal(key, buildOperationKey({ ...operation }));

    const store = new Map();
    const fakeModel = {
        async findOneAndUpdate(query, update) {
            if (!store.has(query.operationKey)) {
                store.set(query.operationKey, update.$setOnInsert);
            }
            return store.get(query.operationKey);
        }
    };

    await recordAiUsage(operation, {
        usage: { promptTokens: 1, outputTokens: 2, totalTokens: 3 },
        latencyMs: 4,
        success: true
    }, fakeModel);
    await recordAiUsage(operation, {
        usage: { promptTokens: 9, outputTokens: 9, totalTokens: 18 },
        latencyMs: 9,
        success: true
    }, fakeModel);

    assert.equal(store.size, 1);
    assert.equal(store.get(key).totalTokens, 3);
});
