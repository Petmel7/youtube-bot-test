const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createAdminRoutes } = require("../src/routes/adminRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const { createAdminPaymentObservabilityService } = require("../src/services/payments/adminPaymentObservabilityService");
const { createPaymentReconciliationService } = require("../src/services/payments/paymentReconciliationService");

const adminUserId = "64d000000000000000000001";
const regularUserId = "64d000000000000000000002";
const intentId = "65e000000000000000000001";
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

const request = async (app, { method = "GET", path, userId = adminUserId, role = "admin", body, headers = {} } = {}) => {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            method,
            headers: {
                ...(body ? { "Content-Type": "application/json" } : {}),
                ...(userId ? { "X-Test-User": userId, "X-Test-Role": role } : {}),
                ...headers
            },
            body: body === undefined ? undefined : JSON.stringify(body)
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

const queryList = (docs, calls) => {
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

const createPaymentIntentReconciliationModel = (docs = []) => {
    const state = new Map(docs.map(doc => [String(doc._id), clone(doc)]));
    const calls = { finds: [], findByIds: [], updates: [], limits: [] };

    return {
        calls,
        state,
        find(filter) {
            calls.finds.push(filter);
            return queryList([...state.values()], {
                sorts: [],
                limits: calls.limits
            });
        },
        async findById(id) {
            calls.findByIds.push(String(id));
            return clone(state.get(String(id)));
        },
        async findOneAndUpdate(filter, update) {
            calls.updates.push({ filter, update });
            const doc = state.get(String(filter._id));
            if (!doc) return null;
            Object.assign(doc, update.$set || {});
            return clone(doc);
        }
    };
};

const createAuditModel = () => {
    const entries = [];
    return {
        entries,
        async create(docs) {
            const created = docs.map((doc, index) => ({
                _id: `68a00000000000000000000${entries.length + index}`,
                createdAt: "2026-08-18T10:10:00.000Z",
                ...clone(doc)
            }));
            entries.push(...created);
            return created;
        },
        find() {
            return queryList(entries, { sorts: [], limits: [] });
        }
    };
};

test("admin reconciliation candidates endpoint is admin-only and bounded", async () => {
    const PaymentIntentModel = createPaymentIntentReconciliationModel([
        makeIntent({
            _id: "65e000000000000000000004",
            status: "MANUAL_REVIEW_REQUIRED",
            failureCode: "PAYMENT_UNDERPAID",
            reviewStatus: null,
            createdAt: "2026-08-18T10:03:00.000Z"
        }),
        makeIntent({
            _id: "65e000000000000000000003",
            status: "CONFIRMED",
            creditedTransactionId: null,
            createdAt: "2026-08-18T10:02:00.000Z"
        })
    ]);
    const PaymentAuditLogModel = createAuditModel();
    const reconciliationService = createPaymentReconciliationService({ PaymentIntentModel, PaymentAuditLogModel });
    const app = createApp({ paymentReconciliationService: reconciliationService });

    const unauthenticated = await request(app, { path: "/api/admin/payments/reconciliation", userId: null });
    const forbidden = await request(app, { path: "/api/admin/payments/reconciliation", userId: regularUserId, role: "user" });
    const response = await request(app, { path: "/api/admin/payments/reconciliation?limit=1" });

    assert.equal(unauthenticated.status, 401);
    assert.equal(forbidden.status, 403);
    assert.equal(response.status, 200);
    assert.equal(response.body.limit, 1);
    assert.equal(response.body.candidates.length, 1);
    assert.equal(response.body.candidates[0].reason, "MANUAL_REVIEW");
    assert.equal(response.body.candidates[0].intent.rpcUrl, undefined);
    assert.equal(response.body.candidates[0].intent.idempotencyKey, undefined);
    assert.deepEqual(PaymentIntentModel.calls.limits, [2]);
});

test("admin retry verify uses lifecycle owner path and writes audit log", async () => {
    const PaymentIntentModel = createPaymentIntentReconciliationModel([
        makeIntent({
            status: "CONFIRMING",
            txHash: null,
            candidateTxHash: txHash,
            creditedTransactionId: null
        })
    ]);
    const PaymentAuditLogModel = createAuditModel();
    const lifecycleCalls = [];
    const lifecycleService = {
        async verifyIntent(args) {
            lifecycleCalls.push(args);
            assert.equal(String(args.userId), regularUserId);
            assert.equal(String(args.paymentIntentId), intentId);
            assert.equal(args.txHash, txHash);
            return {
                intent: makeIntent({ status: "CONFIRMED", txHash, creditedTransactionId: "66f000000000000000000001" }),
                settlement: { settled: true, created: true }
            };
        }
    };
    const reconciliationService = createPaymentReconciliationService({
        PaymentIntentModel,
        PaymentAuditLogModel,
        lifecycleService
    });
    const app = createApp({ paymentReconciliationService: reconciliationService });

    const response = await request(app, {
        method: "POST",
        path: `/api/admin/payments/intents/${intentId}/retry-verify`,
        headers: { "X-CSRF-Protection": "1" }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.intent.status, "CONFIRMED");
    assert.equal(lifecycleCalls.length, 1);
    assert.equal(PaymentAuditLogModel.entries.length, 1);
    assert.equal(PaymentAuditLogModel.entries[0].action, "RETRY_VERIFY");
    assert.equal(PaymentAuditLogModel.entries[0].metadata.settled, true);
    assert.equal(PaymentAuditLogModel.entries[0].metadata.rpcUrl, undefined);
});

test("admin retry settles confirmed paid-but-uncredited intent without manual credit", async () => {
    const PaymentIntentModel = createPaymentIntentReconciliationModel([
        makeIntent({
            status: "CONFIRMED",
            creditedTransactionId: null,
            txHash
        })
    ]);
    const PaymentAuditLogModel = createAuditModel();
    const settlementCalls = [];
    const settlementService = {
        async settlePaymentIntent(args) {
            settlementCalls.push(args);
            assert.equal(String(args.userId), regularUserId);
            return {
                settled: true,
                created: false,
                wallet: { id: "wallet-1", balance: 850, reserved: 0, unit: "AI_CREDIT" },
                transaction: { id: "tx-1", type: "CREDIT", amount: 750, txHash }
            };
        }
    };
    const reconciliationService = createPaymentReconciliationService({
        PaymentIntentModel,
        PaymentAuditLogModel,
        settlementService
    });
    const app = createApp({ paymentReconciliationService: reconciliationService });

    const response = await request(app, {
        method: "POST",
        path: `/api/admin/payments/intents/${intentId}/retry-verify`,
        headers: { "X-CSRF-Protection": "1" }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.settlement.settled, true);
    assert.equal(response.body.settlement.transaction.idempotencyKey, undefined);
    assert.equal(settlementCalls.length, 1);
    assert.equal(PaymentAuditLogModel.entries[0].metadata.outcome, "SETTLEMENT_RETRY");
});

test("admin retry verify logs retryable failure without exposing provider payload", async () => {
    const PaymentIntentModel = createPaymentIntentReconciliationModel([
        makeIntent({ status: "SUBMITTED", txHash: null, candidateTxHash: txHash, creditedTransactionId: null })
    ]);
    const PaymentAuditLogModel = createAuditModel();
    const providerError = Object.assign(new Error("raw rpc url https://secret.example.invalid/key"), {
        status: 503,
        code: "PAYMENT_PROVIDER_FAILURE",
        rawProviderPayload: { secret: "hidden" }
    });
    const lifecycleService = {
        async verifyIntent() {
            throw providerError;
        }
    };
    const reconciliationService = createPaymentReconciliationService({
        PaymentIntentModel,
        PaymentAuditLogModel,
        lifecycleService
    });

    await assert.rejects(() => reconciliationService.retryVerificationOrSettlement({
        paymentIntentId: intentId,
        actorUserId: adminUserId
    }), { code: "PAYMENT_PROVIDER_FAILURE" });

    assert.equal(PaymentAuditLogModel.entries.length, 1);
    assert.deepEqual(PaymentAuditLogModel.entries[0].metadata, {
        outcome: "ERROR",
        errorCode: "PAYMENT_PROVIDER_FAILURE",
        errorStatus: 503
    });
});

test("admin mark reviewed requires note, does not credit, and writes audit log", async () => {
    const PaymentIntentModel = createPaymentIntentReconciliationModel([
        makeIntent({
            status: "MANUAL_REVIEW_REQUIRED",
            creditedTransactionId: null,
            failureCode: "PAYMENT_UNDERPAID"
        })
    ]);
    const PaymentAuditLogModel = createAuditModel();
    const reconciliationService = createPaymentReconciliationService({ PaymentIntentModel, PaymentAuditLogModel });
    const app = createApp({ paymentReconciliationService: reconciliationService });

    const missingNote = await request(app, {
        method: "POST",
        path: `/api/admin/payments/intents/${intentId}/review`,
        headers: { "X-CSRF-Protection": "1" },
        body: { action: "MARK_UNDERPAYMENT_ACKNOWLEDGED", note: "" }
    });
    const response = await request(app, {
        method: "POST",
        path: `/api/admin/payments/intents/${intentId}/review`,
        headers: { "X-CSRF-Protection": "1" },
        body: { action: "MARK_UNDERPAYMENT_ACKNOWLEDGED", note: "User contacted support about underpayment." }
    });

    assert.equal(missingNote.status, 400);
    assert.equal(response.status, 200);
    assert.equal(response.body.candidate.reviewStatus, "UNDERPAYMENT_ACKNOWLEDGED");
    assert.equal(response.body.candidate.intent.credited, false);
    assert.equal(PaymentIntentModel.calls.updates.length, 1);
    assert.equal(PaymentIntentModel.calls.updates[0].update.$set.creditedTransactionId, undefined);
    assert.equal(PaymentAuditLogModel.entries.length, 1);
    assert.equal(PaymentAuditLogModel.entries[0].action, "MARK_UNDERPAYMENT_ACKNOWLEDGED");
    assert.equal(PaymentAuditLogModel.entries[0].note, "User contacted support about underpayment.");
});
