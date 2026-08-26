const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createAdminRoutes } = require("../src/routes/adminRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const { createAdminPaymentObservabilityService } = require("../src/services/payments/adminPaymentObservabilityService");

const adminUserId = "64d000000000000000000001";
const regularUserId = "64d000000000000000000002";
const treasuryAddress = "0x1111111111111111111111111111111111111111";
const payerAddress = "0x2222222222222222222222222222222222222222";
const txHash = `0x${"a".repeat(64)}`;

const clone = (value) => value ? JSON.parse(JSON.stringify(value)) : null;

const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some(orFilter => matches(doc, orFilter));
    if (value && typeof value === "object" && "$lt" in value) {
        return new Date(doc[key]).getTime() < new Date(value.$lt).getTime();
    }
    return String(doc[key]) === String(value);
});

const query = (docs, calls) => {
    const state = { docs: docs.map(clone), limitValue: null };
    const chain = {
        sort(sortValue) {
            calls.sorts.push(sortValue);
            state.docs.sort((left, right) => {
                const dateDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
                if (dateDelta !== 0) return dateDelta;
                return String(right._id).localeCompare(String(left._id));
            });
            return chain;
        },
        limit(limitValue) {
            calls.limits.push(limitValue);
            state.limitValue = limitValue;
            return chain;
        },
        lean() {
            return Promise.resolve(state.limitValue ? state.docs.slice(0, state.limitValue) : state.docs);
        }
    };
    return chain;
};

const createModel = (docs) => {
    const calls = { filters: [], limits: [], sorts: [] };
    return {
        calls,
        find(filter) {
            calls.filters.push(filter);
            return query(docs.filter(doc => matches(doc, filter)), calls);
        }
    };
};

const createApp = (service) => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        const userId = req.get("X-Test-User");
        const role = req.get("X-Test-Role") || "user";
        req.isAuthenticated = () => Boolean(userId);
        if (userId) req.user = { _id: userId, id: userId, role };
        next();
    });
    app.use("/api/admin", createAdminRoutes(service));
    app.use(errorHandler);
    return app;
};

const request = async (app, { path, userId = adminUserId, role = "admin" } = {}) => {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            headers: {
                ...(userId ? { "X-Test-User": userId, "X-Test-Role": role } : {})
            }
        });
        return { status: response.status, body: await response.json() };
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
};

const paymentConfig = {
    confirmations: 60,
    intentTtlMinutes: 30,
    pricingVersion: "pricing-v1",
    packagesJson: JSON.stringify([{ packageId: "starter_credits", creditAmount: 750, expectedUsdAmountMinor: 500 }]),
    methodsJson: JSON.stringify([
        {
            id: "base-mainnet-usdc",
            enabled: true,
            rpcUrl: "https://secret-rpc.example.invalid/key",
            treasuryAddress,
            confirmations: 20
        },
        {
            id: "ethereum-mainnet-usdt",
            enabled: false,
            rpcUrl: "https://secret-ethereum.example.invalid/key",
            treasuryAddress,
            confirmations: 30
        }
    ])
};

const makeIntent = (overrides = {}) => ({
    _id: "65e000000000000000000001",
    userId: regularUserId,
    status: "CONFIRMED",
    paymentMethodId: "base-mainnet-usdc",
    namespace: "eip155",
    networkId: "8453",
    chainId: 8453,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    expectedUsdAmountMinor: 500,
    creditAmount: 750,
    expectedTokenAmountBaseUnits: "5000000",
    txHash,
    transactionSignature: null,
    candidateTxHash: txHash,
    payerAddress,
    confirmationCount: 20,
    creditedTransactionId: "66f000000000000000000001",
    failureCode: null,
    failureReason: null,
    paymentMethodSnapshot: {
        namespace: "eip155",
        network: "base-mainnet",
        networkId: "8453",
        caipNetworkId: "eip155:8453",
        confirmations: 20
    },
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T10:05:00.000Z",
    expiresAt: "2026-08-18T10:30:00.000Z",
    confirmedAt: "2026-08-18T10:05:00.000Z",
    idempotencyKey: "hidden-intent-key",
    ...overrides
});

const makeLedger = (overrides = {}) => ({
    _id: "67a000000000000000000001",
    userId: regularUserId,
    walletId: "67b000000000000000000001",
    type: "CREDIT",
    amount: 750,
    unit: "AI_CREDIT",
    balanceBefore: 100,
    balanceAfter: 850,
    paymentIntentId: "65e000000000000000000001",
    paymentMethodId: "base-mainnet-usdc",
    namespace: "eip155",
    networkId: "8453",
    chainId: 8453,
    txHash,
    idempotencyKey: "payment:secret:credit",
    createdAt: "2026-08-18T10:06:00.000Z",
    ...overrides
});

test("admin payment methods endpoint is admin-only and excludes rpcUrl", async () => {
    const service = createAdminPaymentObservabilityService({ config: paymentConfig });
    const app = createApp(service);

    const unauthenticated = await request(app, { path: "/api/admin/payments/methods", userId: null });
    const forbidden = await request(app, { path: "/api/admin/payments/methods", userId: regularUserId, role: "user" });
    const response = await request(app, { path: "/api/admin/payments/methods" });

    assert.equal(unauthenticated.status, 401);
    assert.equal(forbidden.status, 403);
    assert.equal(response.status, 200);
    assert.equal(response.body.paymentMethods.length, 2);
    assert.equal(response.body.paymentMethods[0].id, "base-mainnet-usdc");
    assert.equal(response.body.paymentMethods[0].treasuryAddress, treasuryAddress);
    assert.equal(response.body.paymentMethods[0].confirmations, 20);
    assert.equal(response.body.paymentMethods[0].token.symbol, "USDC");
    assert.equal(response.body.paymentMethods[0].rpcUrl, undefined);
    assert.equal(response.body.paymentMethods[0].enabled, true);
    assert.equal(response.body.paymentMethods[1].enabled, false);
});

test("admin recent payment intents endpoint is paginated and hides internals", async () => {
    const PaymentIntentModel = createModel([
        makeIntent({ _id: "65e000000000000000000004", createdAt: "2026-08-18T10:03:00.000Z" }),
        makeIntent({ _id: "65e000000000000000000003", status: "PENDING", createdAt: "2026-08-18T10:02:00.000Z" }),
        makeIntent({ _id: "65e000000000000000000002", paymentMethodId: "ethereum-mainnet-usdt", createdAt: "2026-08-18T10:01:00.000Z" }),
        makeIntent({ _id: "65e000000000000000000001", createdAt: "2026-08-18T10:00:00.000Z" })
    ]);
    const service = createAdminPaymentObservabilityService({ PaymentIntentModel, config: paymentConfig });
    const app = createApp(service);

    const response = await request(app, {
        path: "/api/admin/payments/intents?status=CONFIRMED&methodId=base-mainnet-usdc&limit=1"
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.limit, 1);
    assert.equal(response.body.intents.length, 1);
    assert.equal(response.body.intents[0].id, "65e000000000000000000004");
    assert.equal(response.body.intents[0].userId, regularUserId);
    assert.equal(response.body.intents[0].txHash, txHash);
    assert.equal(response.body.intents[0].requiredConfirmations, 20);
    assert.equal(response.body.intents[0].idempotencyKey, undefined);
    assert.equal(typeof response.body.nextCursor, "string");
    assert.deepEqual(PaymentIntentModel.calls.filters[0], {
        status: "CONFIRMED",
        paymentMethodId: "base-mainnet-usdc"
    });
    assert.deepEqual(PaymentIntentModel.calls.limits, [2]);
});

test("admin recent payment ledger endpoint is bounded and excludes idempotency keys", async () => {
    const WalletTransactionModel = createModel([
        makeLedger({ _id: "67a000000000000000000003", type: "DEBIT", createdAt: "2026-08-18T10:08:00.000Z" }),
        makeLedger({ _id: "67a000000000000000000002", createdAt: "2026-08-18T10:07:00.000Z" }),
        makeLedger({ _id: "67a000000000000000000001", createdAt: "2026-08-18T10:06:00.000Z" })
    ]);
    const service = createAdminPaymentObservabilityService({ WalletTransactionModel, config: paymentConfig });
    const app = createApp(service);

    const response = await request(app, { path: "/api/admin/payments/ledger?type=CREDIT&limit=500" });

    assert.equal(response.status, 200);
    assert.equal(response.body.limit, 100);
    assert.equal(response.body.ledger.length, 2);
    assert.equal(response.body.ledger[0].type, "CREDIT");
    assert.equal(response.body.ledger[0].idempotencyKey, undefined);
    assert.deepEqual(WalletTransactionModel.calls.filters[0], { type: "CREDIT" });
    assert.deepEqual(WalletTransactionModel.calls.limits, [101]);
});
