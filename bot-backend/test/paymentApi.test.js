const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createPaymentRoutes } = require("../src/routes/paymentRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const { notFound } = require("../src/utils/errors");
const { createPaymentLifecycleService } = require("../src/services/payments/paymentLifecycleService");
const { PAYMENT_OUTCOMES } = require("../src/services/payments/paymentVerifier");

const userA = "64d000000000000000000001";
const userB = "64d000000000000000000002";
const intentId = "65e000000000000000000001";
const txHash = `0x${"a".repeat(64)}`;

const query = (value) => ({
    session() {
        return this;
    },
    then(resolve, reject) {
        return Promise.resolve(value).then(resolve, reject);
    }
});

const clone = (value) => value ? { ...value } : null;
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
    if (value === null) return doc[key] === null || doc[key] === undefined;
    return String(doc[key]) === String(value);
});

const makeIntent = (overrides = {}) => ({
    _id: intentId,
    userId: userA,
    idempotencyKey: "idem-key-123456",
    packageId: "starter_credits",
    chainId: 8453,
    tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    recipientAddress: "0x1111111111111111111111111111111111111111",
    expectedTokenAmountBaseUnits: "5000000",
    expectedUsdAmountMinor: 500,
    creditAmount: 750,
    pricingVersion: "pricing-v1",
    status: "PENDING",
    txHash: null,
    fromAddress: null,
    firstSeenBlock: null,
    confirmedBlock: null,
    confirmationCount: null,
    verifiedTokenAmountBaseUnits: null,
    transactionStatus: null,
    expiresAt: new Date("2026-08-18T13:00:00.000Z"),
    confirmedAt: null,
    creditedTransactionId: null,
    overpaidAmountBaseUnits: null,
    createdAt: new Date("2026-08-18T10:00:00.000Z"),
    updatedAt: new Date("2026-08-18T10:00:00.000Z"),
    ...overrides
});

const createApp = (paymentLifecycleService, dependencies) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const userId = req.get("X-Test-User");
        req.isAuthenticated = () => Boolean(userId);
        if (userId) req.user = { _id: userId, id: userId };
        next();
    });
    app.use("/api/payments", createPaymentRoutes(paymentLifecycleService, dependencies));
    app.use(errorHandler);
    return app;
};

const request = async (app, { method = "GET", path, userId, body, headers = {} }) => {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                ...(userId ? { "X-Test-User": userId } : {}),
                ...headers
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        return { status: response.status, body: await response.json() };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
};

const createFakeLifecycle = () => {
    const calls = [];
    const intent = makeIntent();
    const service = {
        requiredConfirmations: 12,
        calls,
        async createIntent(args) {
            calls.push({ method: "createIntent", args });
            return { intent, created: !args.idempotencyKey.includes("existing") };
        },
        async getIntent(args) {
            calls.push({ method: "getIntent", args });
            if (args.userId !== userA) throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
            return { intent };
        },
        async verifyIntent(args) {
            calls.push({ method: "verifyIntent", args });
            if (args.userId !== userA) throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
            return { intent: { ...intent, status: "CONFIRMED", txHash: args.txHash }, settlement: { settled: true } };
        }
    };
    return service;
};

const createFakePaymentDependencies = () => ({
    walletService: {
        async getWallet(args) {
            return {
                _id: "wallet-1",
                userId: args.userId,
                balance: 1200,
                reserved: 250,
                unit: "AI_CREDIT",
                secret: "not-for-client"
            };
        }
    },
    paymentPricingService: {
        listPackageSnapshots() {
            return [{
                packageId: "starter_credits",
                creditAmount: 750,
                expectedUsdAmountMinor: 500,
                expectedTokenAmountBaseUnits: "5000000",
                pricingVersion: "pricing-v1",
                internalRate: "not-for-client"
            }];
        }
    }
});

const createMemoryPaymentIntentModel = (initialIntents = []) => {
    const intents = new Map(initialIntents.map(intent => [String(intent._id), clone(intent)]));
    const model = {
        intents,
        findOne(filter) {
            return query(clone([...intents.values()].find(intent => matches(intent, filter))));
        },
        findOneAndUpdate(filter, update, options = {}) {
            const found = [...intents.values()].find(intent => matches(intent, filter));
            if (!found) return query(null);
            if (update.$set) Object.assign(found, update.$set);
            return query(options.new ? clone(found) : clone({ ...found, ...update.$set }));
        }
    };
    return model;
};

const createLifecycleHarness = ({ intent = makeIntent(), verifierResult, settlementResult = { settled: true } } = {}) => {
    const PaymentIntentModel = createMemoryPaymentIntentModel([intent]);
    const verifierCalls = [];
    const settlementCalls = [];
    const service = createPaymentLifecycleService({
        PaymentIntentModel,
        paymentIntentService: {
            async createPaymentIntent(args) {
                const existing = [...PaymentIntentModel.intents.values()].find(doc => (
                    String(doc.userId) === String(args.userId) && doc.idempotencyKey === args.idempotencyKey
                ));
                if (existing) return { intent: clone(existing), created: false };
                const created = makeIntent({
                    _id: `65e00000000000000000000${PaymentIntentModel.intents.size + 2}`,
                    userId: args.userId,
                    packageId: args.packageId,
                    idempotencyKey: args.idempotencyKey
                });
                PaymentIntentModel.intents.set(String(created._id), created);
                return { intent: clone(created), created: true };
            }
        },
        paymentVerifier: {
            async verifyPaymentIntent(paymentIntent) {
                verifierCalls.push(clone(paymentIntent));
                return verifierResult;
            }
        },
        settlementService: {
            async settlePaymentIntent(args) {
                settlementCalls.push(args);
                const doc = PaymentIntentModel.intents.get(String(args.paymentIntentId));
                if (doc) doc.creditedTransactionId = "66f000000000000000000001";
                return settlementResult;
            }
        },
        config: { confirmations: 12 },
        now: () => new Date("2026-08-18T12:00:00.000Z")
    });
    return { service, PaymentIntentModel, verifierCalls, settlementCalls };
};

test("payment API requires authentication", async () => {
    const app = createApp(createFakeLifecycle());

    assert.equal((await request(app, { path: "/api/payments/packages" })).status, 401);
    assert.equal((await request(app, { path: "/api/payments/wallet" })).status, 401);
    assert.equal((await request(app, { method: "POST", path: "/api/payments/intents", body: {} })).status, 401);
    assert.equal((await request(app, { path: `/api/payments/intents/${intentId}` })).status, 401);
    assert.equal((await request(app, { method: "POST", path: `/api/payments/intents/${intentId}/verify`, body: {} })).status, 401);
});

test("payment API lists packages and wallet DTO for authenticated user", async () => {
    const app = createApp(createFakeLifecycle(), createFakePaymentDependencies());

    const packages = await request(app, { path: "/api/payments/packages", userId: userA });
    const wallet = await request(app, { path: "/api/payments/wallet", userId: userA });

    assert.equal(packages.status, 200);
    assert.deepEqual(packages.body.packages, [{
        packageId: "starter_credits",
        creditAmount: 750,
        expectedUsdAmountMinor: 500,
        expectedTokenAmountBaseUnits: "5000000",
        pricingVersion: "pricing-v1"
    }]);
    assert.equal(packages.body.packages[0].internalRate, undefined);

    assert.equal(wallet.status, 200);
    assert.deepEqual(wallet.body.wallet, {
        id: "wallet-1",
        balance: 1200,
        reserved: 250,
        available: 950,
        unit: "AI_CREDIT"
    });
    assert.equal(wallet.body.wallet.userId, undefined);
    assert.equal(wallet.body.wallet.secret, undefined);
});

test("payment API create validates input and sends only backend-safe arguments to lifecycle", async () => {
    const lifecycle = createFakeLifecycle();
    const app = createApp(lifecycle);
    const response = await request(app, {
        method: "POST",
        path: "/api/payments/intents",
        userId: userA,
        headers: { "X-CSRF-Protection": "1", "Idempotency-Key": "client-key-123456" },
        body: {
            packageId: "starter_credits",
            creditAmount: 999999,
            chainId: 1,
            recipientAddress: "0x0000000000000000000000000000000000000000"
        }
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.intent.creditAmount, 750);
    assert.equal(response.body.intent.token.symbol, "USDC");
    assert.equal(response.body.intent.requiredConfirmations, 12);
    assert.deepEqual(lifecycle.calls[0], {
        method: "createIntent",
        args: { userId: userA, packageId: "starter_credits", idempotencyKey: "client-key-123456" }
    });
});

test("payment API write endpoints require write header", async () => {
    const app = createApp(createFakeLifecycle());
    const response = await request(app, {
        method: "POST",
        path: "/api/payments/intents",
        userId: userA,
        headers: { "Idempotency-Key": "client-key-123456" },
        body: { packageId: "starter_credits" }
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "CSRF_HEADER_REQUIRED");
});

test("payment API status and verify enforce ownership through lifecycle user scope", async () => {
    const app = createApp(createFakeLifecycle());

    const status = await request(app, { path: `/api/payments/intents/${intentId}`, userId: userB });
    const verify = await request(app, {
        method: "POST",
        path: `/api/payments/intents/${intentId}/verify`,
        userId: userB,
        headers: { "X-CSRF-Protection": "1" },
        body: { txHash }
    });

    assert.equal(status.status, 404);
    assert.equal(verify.status, 404);
});

test("payment API rejects malformed txHash before lifecycle verification", async () => {
    const lifecycle = createFakeLifecycle();
    const app = createApp(lifecycle);
    const response = await request(app, {
        method: "POST",
        path: `/api/payments/intents/${intentId}/verify`,
        userId: userA,
        headers: { "X-CSRF-Protection": "1" },
        body: { txHash: `0x${"A".repeat(64)}` }
    });

    assert.equal(response.status, 422);
    assert.equal(lifecycle.calls.length, 0);
});

test("payment API verify accepts canonical txHash and returns settlement state", async () => {
    const lifecycle = createFakeLifecycle();
    const app = createApp(lifecycle);
    const response = await request(app, {
        method: "POST",
        path: `/api/payments/intents/${intentId}/verify`,
        userId: userA,
        headers: { "X-CSRF-Protection": "1" },
        body: { txHash, creditAmount: 999999, chainId: 1 }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.intent.txHash, txHash);
    assert.equal(response.body.intent.creditAmount, 750);
    assert.deepEqual(lifecycle.calls[0].args, { userId: userA, paymentIntentId: intentId, txHash });
});

test("payment lifecycle create is idempotent by user and idempotency key", async () => {
    const existing = makeIntent({ idempotencyKey: "same-key-123456" });
    const { service, PaymentIntentModel } = createLifecycleHarness({ intent: existing });

    const [first, second] = await Promise.all([
        service.createIntent({ userId: userA, packageId: "starter_credits", idempotencyKey: "same-key-123456" }),
        service.createIntent({ userId: userA, packageId: "starter_credits", idempotencyKey: "same-key-123456" })
    ]);
    const otherUser = await service.createIntent({ userId: userB, packageId: "starter_credits", idempotencyKey: "same-key-123456" });

    assert.equal(first.created, false);
    assert.equal(second.created, false);
    assert.equal(first.intent._id, existing._id);
    assert.equal(otherUser.created, true);
    assert.equal(PaymentIntentModel.intents.size, 2);
});

test("payment lifecycle maps confirming and underpaid outcomes without settlement", async () => {
    const confirming = createLifecycleHarness({
        verifierResult: {
            outcome: PAYMENT_OUTCOMES.CONFIRMING,
            code: "PAYMENT_CONFIRMING",
            retryable: true,
            txHash,
            confirmationCount: 2,
            confirmedBlock: 100,
            firstSeenBlock: 100,
            transactionStatus: "SUCCESS",
            verifiedTokenAmountBaseUnits: "5000000"
        }
    });
    const confirmingResult = await confirming.service.verifyIntent({ userId: userA, paymentIntentId: intentId, txHash });
    assert.equal(confirmingResult.intent.status, "CONFIRMING");
    assert.equal(confirming.settlementCalls.length, 0);

    const underpaid = createLifecycleHarness({
        verifierResult: {
            outcome: PAYMENT_OUTCOMES.UNDERPAID,
            code: "PAYMENT_UNDERPAID",
            txHash,
            confirmationCount: 12,
            confirmedBlock: 100,
            firstSeenBlock: 100,
            transactionStatus: "SUCCESS",
            verifiedTokenAmountBaseUnits: "1000000"
        }
    });
    const underpaidResult = await underpaid.service.verifyIntent({ userId: userA, paymentIntentId: intentId, txHash });
    assert.equal(underpaidResult.intent.status, "UNDERPAID");
    assert.equal(underpaid.settlementCalls.length, 0);
});

test("payment lifecycle settles exact and overpaid confirmed outcomes only", async () => {
    const exact = createLifecycleHarness({
        verifierResult: {
            outcome: PAYMENT_OUTCOMES.VERIFIED,
            code: "PAYMENT_VERIFIED",
            txHash,
            confirmationCount: 12,
            confirmedBlock: 100,
            firstSeenBlock: 100,
            transactionStatus: "SUCCESS",
            verifiedTokenAmountBaseUnits: "5000000"
        }
    });
    const exactResult = await exact.service.verifyIntent({ userId: userA, paymentIntentId: intentId, txHash });
    assert.equal(exactResult.intent.status, "CONFIRMED");
    assert.equal(exact.settlementCalls.length, 1);

    const overpaid = createLifecycleHarness({
        verifierResult: {
            outcome: PAYMENT_OUTCOMES.OVERPAID,
            code: "PAYMENT_OVERPAID",
            txHash,
            confirmationCount: 12,
            confirmedBlock: 100,
            firstSeenBlock: 100,
            transactionStatus: "SUCCESS",
            verifiedTokenAmountBaseUnits: "7000000"
        }
    });
    const overpaidResult = await overpaid.service.verifyIntent({ userId: userA, paymentIntentId: intentId, txHash });
    assert.equal(overpaidResult.intent.status, "CONFIRMED_OVERPAID");
    assert.equal(overpaid.settlementCalls.length, 1);
});

test("payment lifecycle rejects txHash replacement and expires unsettled intents lazily", async () => {
    const mismatched = createLifecycleHarness({
        intent: makeIntent({ txHash }),
        verifierResult: { outcome: PAYMENT_OUTCOMES.PENDING, code: "PAYMENT_TRANSACTION_NOT_FOUND", txHash, retryable: true }
    });
    await assert.rejects(
        () => mismatched.service.verifyIntent({ userId: userA, paymentIntentId: intentId, txHash: `0x${"b".repeat(64)}` }),
        { code: "PAYMENT_TX_HASH_CONFLICT" }
    );

    const expired = createLifecycleHarness({
        intent: makeIntent({ expiresAt: new Date("2026-08-18T11:59:59.000Z") }),
        verifierResult: { outcome: PAYMENT_OUTCOMES.VERIFIED, code: "PAYMENT_VERIFIED", txHash }
    });
    const result = await expired.service.verifyIntent({ userId: userA, paymentIntentId: intentId, txHash });
    assert.equal(result.intent.status, "EXPIRED");
    assert.equal(expired.verifierCalls.length, 0);
    assert.equal(expired.settlementCalls.length, 0);
});
