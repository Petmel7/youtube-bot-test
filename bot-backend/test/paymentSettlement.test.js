const test = require("node:test");
const assert = require("node:assert/strict");

const PaymentIntent = require("../src/models/PaymentIntent");
const WalletTransaction = require("../src/models/WalletTransaction");
const {
    createPaymentSettlementService,
    paymentCreditKey
} = require("../src/services/payments/paymentSettlementService");
const {
    guardCreditedTransactionIdSave,
    guardCreditedTransactionIdUpdate
} = PaymentIntent;

const userId = "64b000000000000000000001";
const otherUserId = "64b000000000000000000002";
const txHash = `0x${"a".repeat(64)}`;
const otherTxHash = `0x${"b".repeat(64)}`;

const clone = (value) => {
    if (!value) return null;
    return {
        ...value,
        confirmedAt: value.confirmedAt ? new Date(value.confirmedAt) : value.confirmedAt
    };
};

const query = (value) => ({
    session() {
        return this;
    },
    then(resolve, reject) {
        return Promise.resolve(value).then(resolve, reject);
    }
});

const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
    if (value === null) return doc[key] === null || doc[key] === undefined;
    return String(doc[key]) === String(value);
});

const createPaymentIntent = (overrides = {}) => ({
    _id: "payment-intent-1",
    userId,
    idempotencyKey: "intent-idem-1",
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
    status: "CONFIRMED",
    txHash,
    fromAddress: "0x2222222222222222222222222222222222222222",
    firstSeenBlock: 100,
    confirmedBlock: 100,
    confirmationCount: 60,
    verifiedTokenAmountBaseUnits: "5000000",
    transactionStatus: "SUCCESS",
    expiresAt: new Date("2026-08-17T10:30:00.000Z"),
    confirmedAt: null,
    creditedTransactionId: null,
    overpaidAmountBaseUnits: null,
    ...overrides
});

const createFakeModels = ({ failOn } = {}) => {
    const state = {
        intents: new Map(),
        wallets: new Map(),
        transactions: new Map(),
        nextTransactionId: 1
    };

    const snapshot = () => ({
        intents: new Map([...state.intents].map(([key, value]) => [key, clone(value)])),
        wallets: new Map([...state.wallets].map(([key, value]) => [key, clone(value)])),
        transactions: new Map([...state.transactions].map(([key, value]) => [key, clone(value)])),
        nextTransactionId: state.nextTransactionId
    });

    const restore = (copy) => {
        state.intents = copy.intents;
        state.wallets = copy.wallets;
        state.transactions = copy.transactions;
        state.nextTransactionId = copy.nextTransactionId;
    };

    const PaymentIntentModel = {
        findOne(filter) {
            return query(clone([...state.intents.values()].find(intent => matches(intent, filter))));
        },
        findOneAndUpdate(filter, update, options = {}) {
            if (failOn === "intentUpdate") throw Object.assign(new Error("intent update failed"), { code: "INTENT_UPDATE_FAILED" });

            const intent = [...state.intents.values()].find(doc => matches(doc, filter));
            if (!intent) return query(null);

            if (update.$set) Object.assign(intent, update.$set);
            return query(options.new ? clone(intent) : clone({ ...intent, ...Object.fromEntries(Object.keys(update.$set || {}).map(key => [key, null])) }));
        }
    };

    const WalletModel = {
        findOne(filter) {
            return query(clone([...state.wallets.values()].find(doc => matches(doc, filter))));
        },
        findOneAndUpdate(filter, update, options = {}) {
            let wallet = [...state.wallets.values()].find(doc => matches(doc, filter));
            if (!wallet && options.upsert) {
                wallet = {
                    _id: `${filter.userId}-wallet`,
                    userId: filter.userId,
                    balance: update.$setOnInsert?.balance || 0,
                    reserved: update.$setOnInsert?.reserved || 0,
                    unit: update.$setOnInsert?.unit || "AI_CREDIT"
                };
                state.wallets.set(String(wallet.userId), wallet);
            }

            if (!wallet) return query(null);
            if (failOn === "walletUpdate" && update.$inc?.balance) {
                throw Object.assign(new Error("wallet update failed"), { code: "WALLET_UPDATE_FAILED" });
            }

            const before = clone(wallet);
            if (update.$inc?.balance) wallet.balance += update.$inc.balance;
            if (update.$inc?.reserved) wallet.reserved += update.$inc.reserved;
            return query(options.new ? clone(wallet) : before);
        }
    };

    const TransactionModel = {
        findOne(filter) {
            return query(clone([...state.transactions.values()].find(transaction => matches(transaction, filter))));
        },
        async create(entries) {
            return entries.map((entry) => {
                if ([...state.transactions.values()].some(tx => tx.idempotencyKey === entry.idempotencyKey)) {
                    const error = new Error("duplicate idempotency key");
                    error.code = 11000;
                    throw error;
                }
                if (
                    entry.type === "CREDIT" &&
                    entry.paymentIntentId &&
                    [...state.transactions.values()].some(tx => tx.type === "CREDIT" && String(tx.paymentIntentId) === String(entry.paymentIntentId))
                ) {
                    const error = new Error("duplicate payment intent credit");
                    error.code = 11000;
                    throw error;
                }
                if (
                    entry.type === "CREDIT" &&
                    entry.chainId &&
                    entry.txHash &&
                    [...state.transactions.values()].some(tx => tx.type === "CREDIT" && tx.chainId === entry.chainId && tx.txHash === entry.txHash)
                ) {
                    const error = new Error("duplicate tx credit");
                    error.code = 11000;
                    throw error;
                }

                const doc = { _id: `wallet-transaction-${state.nextTransactionId++}`, ...entry };
                state.transactions.set(doc._id, doc);
                return clone(doc);
            });
        }
    };

    const withTransaction = async (callback) => {
        const before = snapshot();
        try {
            return await callback("session");
        } catch (error) {
            restore(before);
            throw error;
        }
    };

    return { PaymentIntentModel, WalletModel, TransactionModel, state, withTransaction };
};

const createServiceHarness = ({ failOn } = {}) => {
    const models = createFakeModels({ failOn });
    const service = createPaymentSettlementService({
        PaymentIntentModel: models.PaymentIntentModel,
        WalletModel: models.WalletModel,
        TransactionModel: models.TransactionModel,
        withTransaction: models.withTransaction,
        now: () => new Date("2026-08-17T12:00:00.000Z")
    });

    return { service, ...models };
};

const runCreditedTransactionIdGuard = (filter, update) => new Promise((resolve, reject) => {
    guardCreditedTransactionIdUpdate.call({
        getFilter: () => filter,
        getUpdate: () => update
    }, (error) => (error ? reject(error) : resolve()));
});

const runCreditedTransactionIdSaveGuard = (existingValue, nextValue) => new Promise((resolve, reject) => {
    const context = {
        _id: "intent-1",
        creditedTransactionId: nextValue,
        isNew: false,
        isModified: field => field === "creditedTransactionId",
        $session: () => "session",
        constructor: {
            findById: () => ({
                select: () => ({
                    session: async () => ({ creditedTransactionId: existingValue })
                })
            })
        }
    };

    guardCreditedTransactionIdSave.call(context, (error) => (error ? reject(error) : resolve()));
});

const seedWallet = (state, overrides = {}) => {
    const wallet = {
        _id: `${overrides.userId || userId}-wallet`,
        userId,
        balance: 100,
        reserved: 25,
        unit: "AI_CREDIT",
        ...overrides
    };
    state.wallets.set(String(wallet.userId), wallet);
    return wallet;
};

test("PaymentIntent and WalletTransaction schemas expose payment settlement fields and indexes", () => {
    assert(PaymentIntent.schema.path("creditedTransactionId"));
    assert(PaymentIntent.schema.path("overpaidAmountBaseUnits"));
    assert(WalletTransaction.schema.path("paymentIntentId"));
    assert(WalletTransaction.schema.path("chainId"));
    assert(WalletTransaction.schema.path("txHash"));

    const indexes = WalletTransaction.schema.indexes();
    assert(indexes.some(([fields, options]) => (
        fields.paymentIntentId === 1 &&
        fields.type === 1 &&
        options.unique === true &&
        options.partialFilterExpression?.type === "CREDIT"
    )));
    assert(indexes.some(([fields, options]) => (
        fields.chainId === 1 &&
        fields.txHash === 1 &&
        fields.type === 1 &&
        options.unique === true &&
        options.partialFilterExpression?.type === "CREDIT"
    )));
});

test("creditedTransactionId update guard allows first assignment and rejects replacement or removal", async () => {
    await assert.doesNotReject(() => runCreditedTransactionIdGuard(
        { _id: "intent-1", creditedTransactionId: null },
        { $set: { creditedTransactionId: "64c000000000000000000001" } }
    ));

    await assert.rejects(() => runCreditedTransactionIdGuard(
        { _id: "intent-1" },
        { $set: { creditedTransactionId: "64c000000000000000000002" } }
    ), { code: "PAYMENT_CREDITED_TRANSACTION_WRITE_ONCE" });

    await assert.rejects(() => runCreditedTransactionIdGuard(
        { _id: "intent-1", creditedTransactionId: "64c000000000000000000001" },
        { $set: { creditedTransactionId: "64c000000000000000000002" } }
    ), { code: "PAYMENT_CREDITED_TRANSACTION_WRITE_ONCE" });

    await assert.rejects(() => runCreditedTransactionIdGuard(
        { _id: "intent-1", creditedTransactionId: "64c000000000000000000001" },
        { $set: { creditedTransactionId: null } }
    ), { code: "PAYMENT_CREDITED_TRANSACTION_WRITE_ONCE" });

    await assert.rejects(() => runCreditedTransactionIdGuard(
        { _id: "intent-1", creditedTransactionId: "64c000000000000000000001" },
        { $unset: { creditedTransactionId: "" } }
    ), { code: "PAYMENT_CREDITED_TRANSACTION_WRITE_ONCE" });

    await assert.doesNotReject(() => runCreditedTransactionIdSaveGuard(null, "64c000000000000000000001"));
    await assert.doesNotReject(() => runCreditedTransactionIdSaveGuard(
        "64c000000000000000000001",
        "64c000000000000000000001"
    ));
    await assert.rejects(() => runCreditedTransactionIdSaveGuard(
        "64c000000000000000000001",
        "64c000000000000000000002"
    ), { code: "PAYMENT_CREDITED_TRANSACTION_WRITE_ONCE" });
    await assert.rejects(() => runCreditedTransactionIdSaveGuard(
        "64c000000000000000000001",
        null
    ), { code: "PAYMENT_CREDITED_TRANSACTION_WRITE_ONCE" });
});

test("confirmed payment settles once and credits only PaymentIntent.creditAmount", async () => {
    const { service, state } = createServiceHarness();
    const intent = createPaymentIntent({ creditAmount: 750 });
    state.intents.set(intent._id, intent);
    seedWallet(state);

    const result = await service.settlePaymentIntent({
        paymentIntentId: intent._id,
        userId,
        creditAmount: 999999,
        chainId: 1,
        txHash: otherTxHash
    });

    const [transaction] = [...state.transactions.values()];
    const updatedIntent = state.intents.get(intent._id);
    const wallet = state.wallets.get(userId);

    assert.equal(result.created, true);
    assert.equal(wallet.balance, 850);
    assert.equal(wallet.reserved, 25);
    assert.equal(transaction.amount, 750);
    assert.equal(transaction.balanceBefore, 100);
    assert.equal(transaction.balanceAfter, 850);
    assert.equal(transaction.balanceAfter, transaction.balanceBefore + transaction.amount);
    assert.equal(transaction.idempotencyKey, paymentCreditKey(intent._id));
    assert.equal(transaction.paymentIntentId, intent._id);
    assert.equal(transaction.chainId, intent.chainId);
    assert.equal(transaction.txHash, intent.txHash);
    assert.equal(updatedIntent.creditedTransactionId, transaction._id);
    assert.equal(updatedIntent.overpaidAmountBaseUnits, null);
    assert.equal(updatedIntent.status, "CONFIRMED");
});

test("confirmed overpaid payment credits frozen creditAmount and persists overpayment metadata", async () => {
    const { service, state } = createServiceHarness();
    const intent = createPaymentIntent({
        _id: "payment-intent-overpaid",
        status: "CONFIRMED_OVERPAID",
        verifiedTokenAmountBaseUnits: "7000000",
        creditAmount: 750
    });
    state.intents.set(intent._id, intent);
    seedWallet(state);

    const result = await service.settlePaymentIntent({ paymentIntentId: intent._id, userId });
    const transaction = state.transactions.get(result.transaction.id);
    const updatedIntent = state.intents.get(intent._id);

    assert.equal(state.wallets.get(userId).balance, 850);
    assert.equal(transaction.amount, 750);
    assert.equal(transaction.metadata.overpaidAmountBaseUnits, "2000000");
    assert.equal(updatedIntent.overpaidAmountBaseUnits, "2000000");
    assert.equal(updatedIntent.status, "CONFIRMED_OVERPAID");
});

test("ineligible payment states are rejected", async () => {
    const rejectedStates = ["PENDING", "SUBMITTED", "VERIFYING", "CONFIRMING", "UNDERPAID", "EXPIRED", "FAILED", "REJECTED", "CANCELLED"];

    for (const status of rejectedStates) {
        const { service, state } = createServiceHarness();
        const intent = createPaymentIntent({ _id: `intent-${status}`, status });
        state.intents.set(intent._id, intent);
        seedWallet(state);

        await assert.rejects(() => service.settlePaymentIntent({ paymentIntentId: intent._id, userId }), { code: "PAYMENT_NOT_ELIGIBLE" });
        assert.equal(state.wallets.get(userId).balance, 100);
        assert.equal(state.transactions.size, 0);
    }
});

test("settlement requires persisted successful verification metadata", async () => {
    const invalidIntents = [
        createPaymentIntent({ _id: "missing-tx", txHash: null }),
        createPaymentIntent({ _id: "missing-block", confirmedBlock: null }),
        createPaymentIntent({ _id: "missing-confirmations", confirmationCount: null }),
        createPaymentIntent({ _id: "failed-transaction", transactionStatus: "REVERTED" }),
        createPaymentIntent({ _id: "missing-verified-amount", verifiedTokenAmountBaseUnits: null })
    ];

    for (const intent of invalidIntents) {
        const { service, state } = createServiceHarness();
        state.intents.set(intent._id, intent);
        seedWallet(state);

        await assert.rejects(() => service.settlePaymentIntent({ paymentIntentId: intent._id, userId }), { code: "PAYMENT_NOT_ELIGIBLE" });
    }
});

test("repeated and concurrent settlement attempts converge to one CREDIT", async () => {
    const { service, state } = createServiceHarness();
    const intent = createPaymentIntent();
    state.intents.set(intent._id, intent);
    seedWallet(state);

    const first = await service.settlePaymentIntent({ paymentIntentId: intent._id, userId });
    const second = await service.settlePaymentIntent({ paymentIntentId: intent._id, userId });
    const concurrent = await Promise.all([
        service.settlePaymentIntent({ paymentIntentId: intent._id, userId }),
        service.settlePaymentIntent({ paymentIntentId: intent._id, userId })
    ]);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert(concurrent.every(result => result.created === false));
    assert.equal(state.wallets.get(userId).balance, 850);
    assert.equal(state.transactions.size, 1);
});

test("existing creditedTransactionId returns idempotent success without wallet increment", async () => {
    const { service, state } = createServiceHarness();
    const intent = createPaymentIntent({ creditedTransactionId: "existing-credit" });
    const credit = {
        _id: "existing-credit",
        userId,
        walletId: `${userId}-wallet`,
        type: "CREDIT",
        amount: intent.creditAmount,
        paymentIntentId: intent._id,
        chainId: intent.chainId,
        txHash: intent.txHash,
        idempotencyKey: paymentCreditKey(intent._id)
    };
    state.intents.set(intent._id, intent);
    state.transactions.set(credit._id, credit);
    seedWallet(state, { balance: 850 });

    const result = await service.settlePaymentIntent({ paymentIntentId: intent._id, userId });

    assert.equal(result.created, false);
    assert.equal(state.wallets.get(userId).balance, 850);
    assert.equal(state.transactions.size, 1);
});

test("duplicate paymentIntent and duplicate txHash credits are prevented", async () => {
    const duplicateByIntent = createServiceHarness();
    const intent = createPaymentIntent();
    duplicateByIntent.state.intents.set(intent._id, intent);
    duplicateByIntent.state.transactions.set("conflicting-credit", {
        _id: "conflicting-credit",
        type: "CREDIT",
        amount: intent.creditAmount,
        paymentIntentId: intent._id,
        chainId: intent.chainId,
        txHash: otherTxHash,
        idempotencyKey: "conflicting-key"
    });
    seedWallet(duplicateByIntent.state);

    await assert.rejects(() => duplicateByIntent.service.settlePaymentIntent({ paymentIntentId: intent._id, userId }), {
        code: "PAYMENT_ACCOUNTING_INVARIANT_FAILED"
    });

    const duplicateByTx = createServiceHarness();
    const firstIntent = createPaymentIntent({ _id: "first-intent" });
    const secondIntent = createPaymentIntent({ _id: "second-intent" });
    duplicateByTx.state.intents.set(firstIntent._id, firstIntent);
    duplicateByTx.state.intents.set(secondIntent._id, secondIntent);
    duplicateByTx.state.transactions.set("first-credit", {
        _id: "first-credit",
        type: "CREDIT",
        amount: firstIntent.creditAmount,
        paymentIntentId: firstIntent._id,
        chainId: firstIntent.chainId,
        txHash: firstIntent.txHash,
        idempotencyKey: paymentCreditKey(firstIntent._id)
    });
    seedWallet(duplicateByTx.state);

    await assert.rejects(() => duplicateByTx.service.settlePaymentIntent({ paymentIntentId: secondIntent._id, userId }), {
        code: "PAYMENT_DUPLICATE_TX"
    });
});

test("settlement rejects another user's PaymentIntent", async () => {
    const { service, state } = createServiceHarness();
    const intent = createPaymentIntent();
    state.intents.set(intent._id, intent);
    seedWallet(state);

    await assert.rejects(() => service.settlePaymentIntent({ paymentIntentId: intent._id, userId: otherUserId }), {
        code: "PAYMENT_INTENT_NOT_FOUND"
    });
});

test("different payment intents for same user use atomic increments without losing balance", async () => {
    const { service, state } = createServiceHarness();
    const first = createPaymentIntent({ _id: "intent-one", txHash });
    const second = createPaymentIntent({ _id: "intent-two", txHash: otherTxHash, creditAmount: 1800 });
    state.intents.set(first._id, first);
    state.intents.set(second._id, second);
    seedWallet(state, { balance: 0, reserved: 80 });

    const results = await Promise.all([
        service.settlePaymentIntent({ paymentIntentId: first._id, userId }),
        service.settlePaymentIntent({ paymentIntentId: second._id, userId })
    ]);

    assert(results.every(result => result.created === true));
    assert.equal(state.wallets.get(userId).balance, 2550);
    assert.equal(state.wallets.get(userId).reserved, 80);
    assert.equal(state.transactions.size, 2);

    const transitions = [...state.transactions.values()]
        .map(transaction => [transaction.balanceBefore, transaction.balanceAfter, transaction.amount])
        .sort((left, right) => left[0] - right[0]);
    assert.deepEqual(transitions, [
        [0, 750, 750],
        [750, 2550, 1800]
    ]);
});

test("transaction rollback removes CREDIT, wallet increment, and intent update on failures", async () => {
    const walletFailure = createServiceHarness({ failOn: "walletUpdate" });
    const walletIntent = createPaymentIntent();
    walletFailure.state.intents.set(walletIntent._id, walletIntent);
    seedWallet(walletFailure.state);

    await assert.rejects(() => walletFailure.service.settlePaymentIntent({ paymentIntentId: walletIntent._id, userId }), {
        code: "WALLET_UPDATE_FAILED"
    });
    assert.equal(walletFailure.state.wallets.get(userId).balance, 100);
    assert.equal(walletFailure.state.intents.get(walletIntent._id).creditedTransactionId, null);
    assert.equal(walletFailure.state.transactions.size, 0);

    const intentFailure = createServiceHarness({ failOn: "intentUpdate" });
    const intent = createPaymentIntent();
    intentFailure.state.intents.set(intent._id, intent);
    seedWallet(intentFailure.state);

    await assert.rejects(() => intentFailure.service.settlePaymentIntent({ paymentIntentId: intent._id, userId }), {
        code: "INTENT_UPDATE_FAILED"
    });
    assert.equal(intentFailure.state.wallets.get(userId).balance, 100);
    assert.equal(intentFailure.state.intents.get(intent._id).creditedTransactionId, null);
    assert.equal(intentFailure.state.transactions.size, 0);
});
