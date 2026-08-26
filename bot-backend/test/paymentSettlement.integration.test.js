const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const PaymentIntent = require("../src/models/PaymentIntent");
const Wallet = require("../src/models/Wallet");
const WalletTransaction = require("../src/models/WalletTransaction");
const paymentSettlementService = require("../src/services/payments/paymentSettlementService");
const {
    createPaymentSettlementService
} = require("../src/services/payments/paymentSettlementService");

const mongoUri = process.env.PAYMENT_SETTLEMENT_INTEGRATION_MONGO_URI;

function assertTestDatabase(uri) {
    const { pathname } = new URL(uri);
    const databaseName = pathname.replace(/^\//, "");

    assert.ok(databaseName, "PAYMENT_SETTLEMENT_INTEGRATION_MONGO_URI must include an explicit database name");
    assert.ok(
        /test|integration/i.test(databaseName),
        "PAYMENT_SETTLEMENT_INTEGRATION_MONGO_URI must point to a test/integration database"
    );
}

const txHashFor = (letter) => `0x${letter.repeat(64)}`;

const createIntentDocument = ({ userId, paymentIntentId = new mongoose.Types.ObjectId(), txHash = txHashFor("a"), creditAmount = 750 } = {}) => ({
    _id: paymentIntentId,
    userId,
    idempotencyKey: `integration-${paymentIntentId}`,
    packageId: "integration-pack",
    paymentMethodId: "base-mainnet-usdc",
    paymentMethodSnapshot: {
        id: "base-mainnet-usdc",
        name: "Base mainnet USDC",
        namespace: "eip155",
        network: "base-mainnet",
        networkId: "8453",
        caipNetworkId: "eip155:8453",
        chainId: 8453,
        rpcUrl: "https://base.example.invalid/rpc",
        tokenAddress: `0x${"b".repeat(40)}`,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        treasuryAddress: `0x${"c".repeat(40)}`,
        confirmations: 12
    },
    namespace: "eip155",
    networkId: "8453",
    chainId: 8453,
    tokenAddress: `0x${"b".repeat(40)}`,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    recipientAddress: `0x${"c".repeat(40)}`,
    expectedTokenAmountBaseUnits: "5000000",
    expectedUsdAmountMinor: 500,
    creditAmount,
    pricingVersion: "integration-test",
    payerAddress: `0x${"e".repeat(40)}`,
    payerChallengeId: new mongoose.Types.ObjectId(),
    status: "CONFIRMED",
    txHash,
    fromAddress: `0x${"d".repeat(40)}`,
    firstSeenBlock: 100,
    confirmedBlock: 112,
    confirmationCount: 12,
    verifiedTokenAmountBaseUnits: "5000000",
    transactionStatus: "SUCCESS",
    expiresAt: new Date(Date.now() + 60_000)
});

const cleanupUser = async (userId) => {
    await Promise.all([
        PaymentIntent.deleteMany({ userId }),
        Wallet.deleteMany({ userId }),
        WalletTransaction.deleteMany({ userId })
    ]);
};

const assertTransactionCapable = async () => {
    const userId = new mongoose.Types.ObjectId();
    const marker = Object.assign(new Error("transaction rollback probe"), { code: "INTEGRATION_ROLLBACK_PROBE" });

    try {
        await mongoose.connection.transaction(async (session) => {
            await Wallet.create([{ userId, balance: 1, reserved: 0 }], { session });
            throw marker;
        });
    } catch (error) {
        if (error.code !== marker.code) {
            throw new Error(`MongoDB integration URI must support transactions: ${error.message}`);
        }
    }

    const wallet = await Wallet.findOne({ userId }).lean();
    assert.equal(wallet, null, "transaction rollback probe left data behind");
};

const assertPaymentIndexes = async () => {
    const indexes = await WalletTransaction.collection.indexes();
    const hasPaymentIntentCredit = indexes.some(index => (
        index.unique === true &&
        index.key.paymentIntentId === 1 &&
        index.key.type === 1 &&
        index.partialFilterExpression?.type === "CREDIT" &&
        index.partialFilterExpression?.paymentIntentId?.$type === "objectId"
    ));
    const hasTxHashCredit = indexes.some(index => (
        index.unique === true &&
        index.key.namespace === 1 &&
        index.key.networkId === 1 &&
        index.key.txHash === 1 &&
        index.key.type === 1 &&
        index.partialFilterExpression?.type === "CREDIT" &&
        index.partialFilterExpression?.namespace?.$type === "string" &&
        index.partialFilterExpression?.networkId?.$type === "string" &&
        index.partialFilterExpression?.txHash?.$type === "string"
    ));

    assert.equal(hasPaymentIntentCredit, true, "missing paymentIntentId CREDIT unique partial index");
    assert.equal(hasTxHashCredit, true, "missing namespace/networkId/txHash CREDIT unique partial index");
};

const assertSettlementState = async ({ userId, paymentIntentId, expectedBalance, expectedCredits = 1, expectedReserved = 0 }) => {
    const wallet = await Wallet.findOne({ userId }).lean();
    const credits = await WalletTransaction.find({ userId, paymentIntentId, type: "CREDIT" }).lean();
    const intent = await PaymentIntent.findById(paymentIntentId).lean();

    assert.equal(wallet.balance, expectedBalance);
    assert.equal(wallet.reserved, expectedReserved);
    assert.equal(credits.length, expectedCredits);
    assert.equal(String(intent.creditedTransactionId), String(credits[0]._id));
    assert.equal(credits[0].balanceAfter, credits[0].balanceBefore + credits[0].amount);

    return { wallet, credits, intent };
};

const assertSerializedCreditTransitions = ({ credits, initialBalance, finalBalance, expectedAmounts }) => {
    const transitions = credits
        .map(transaction => [transaction.balanceBefore, transaction.balanceAfter, transaction.amount])
        .sort((left, right) => left[0] - right[0]);
    const amounts = transitions.map(([, , amount]) => amount).sort((left, right) => left - right);

    assert.deepEqual(amounts, [...expectedAmounts].sort((left, right) => left - right));
    assert.equal(transitions[0][0], initialBalance);
    assert.equal(transitions.at(-1)[1], finalBalance);

    for (let index = 0; index < transitions.length; index += 1) {
        const [balanceBefore, balanceAfter, amount] = transitions[index];
        assert.equal(balanceAfter, balanceBefore + amount);

        if (index > 0) {
            assert.equal(balanceBefore, transitions[index - 1][1]);
        }
    }

    return transitions;
};

test("payment settlement integration uses real MongoDB transactions and payment indexes", {
    skip: mongoUri ? false : "set PAYMENT_SETTLEMENT_INTEGRATION_MONGO_URI to run live MongoDB settlement coverage"
}, async (t) => {
    assertTestDatabase(mongoUri);

    await mongoose.connect(mongoUri);

    try {
        await assertTransactionCapable();
        await Promise.all([
            PaymentIntent.syncIndexes(),
            Wallet.syncIndexes(),
            WalletTransaction.syncIndexes()
        ]);
        await assertPaymentIndexes();

        await t.test("CREDIT insert rollback leaves no settlement artifacts", async () => {
            const userId = new mongoose.Types.ObjectId();
            const intent = createIntentDocument({ userId, txHash: txHashFor("a") });
            await cleanupUser(userId);
            await Wallet.create({ userId, balance: 100, reserved: 10 });
            await PaymentIntent.create(intent);

            const TransactionModel = {
                findOne: (filter) => WalletTransaction.findOne(filter),
                create: async (entries, options) => {
                    await WalletTransaction.create(entries, options);
                    throw Object.assign(new Error("forced failure after credit"), { code: "INTEGRATION_AFTER_CREDIT" });
                }
            };
            const service = createPaymentSettlementService({ TransactionModel });

            await assert.rejects(
                () => service.settlePaymentIntent({ paymentIntentId: intent._id, userId }),
                { code: "INTEGRATION_AFTER_CREDIT" }
            );

            const wallet = await Wallet.findOne({ userId }).lean();
            const credits = await WalletTransaction.find({ userId, type: "CREDIT" }).lean();
            const updatedIntent = await PaymentIntent.findById(intent._id).lean();

            assert.equal(wallet.balance, 100);
            assert.equal(wallet.reserved, 10);
            assert.equal(credits.length, 0);
            assert.equal(updatedIntent.creditedTransactionId, null);
            assert.equal(updatedIntent.overpaidAmountBaseUnits, null);
            assert.equal(updatedIntent.status, "CONFIRMED");
        });

        await t.test("wallet mutation and PaymentIntent update rollback together", async () => {
            const userId = new mongoose.Types.ObjectId();
            const intent = createIntentDocument({ userId, txHash: txHashFor("e") });
            await cleanupUser(userId);
            await Wallet.create({ userId, balance: 200, reserved: 15 });
            await PaymentIntent.create(intent);

            const PaymentIntentModel = {
                findOne: (filter) => PaymentIntent.findOne(filter),
                findOneAndUpdate: (filter, update, options) => {
                    if (filter.creditedTransactionId === null) {
                        throw Object.assign(new Error("forced intent update failure"), { code: "INTEGRATION_INTENT_UPDATE" });
                    }
                    return PaymentIntent.findOneAndUpdate(filter, update, options);
                }
            };
            const service = createPaymentSettlementService({ PaymentIntentModel });

            await assert.rejects(
                () => service.settlePaymentIntent({ paymentIntentId: intent._id, userId }),
                { code: "INTEGRATION_INTENT_UPDATE" }
            );

            const wallet = await Wallet.findOne({ userId }).lean();
            const credits = await WalletTransaction.find({ userId, type: "CREDIT" }).lean();
            const updatedIntent = await PaymentIntent.findById(intent._id).lean();

            assert.equal(wallet.balance, 200);
            assert.equal(wallet.reserved, 15);
            assert.equal(credits.length, 0);
            assert.equal(updatedIntent.creditedTransactionId, null);
        });

        await t.test("duplicate PaymentIntent settlement is idempotent", async () => {
            const userId = new mongoose.Types.ObjectId();
            const intent = createIntentDocument({ userId, txHash: txHashFor("f") });
            await cleanupUser(userId);
            await Wallet.create({ userId, balance: 0, reserved: 7 });
            await PaymentIntent.create(intent);

            const first = await paymentSettlementService.settlePaymentIntent({ paymentIntentId: intent._id, userId });
            const second = await paymentSettlementService.settlePaymentIntent({ paymentIntentId: intent._id, userId });
            const state = await assertSettlementState({
                userId,
                paymentIntentId: intent._id,
                expectedBalance: 750,
                expectedReserved: 7
            });

            assert.equal(first.created, true);
            assert.equal(second.created, false);
            assert.equal(state.credits[0].balanceBefore, 0);
            assert.equal(state.credits[0].balanceAfter, 750);
        });

        await t.test("duplicate txHash is rejected by real unique indexes", async () => {
            const userId = new mongoose.Types.ObjectId();
            const firstIntent = createIntentDocument({ userId, txHash: txHashFor("1") });
            const secondIntent = createIntentDocument({
                userId,
                paymentIntentId: new mongoose.Types.ObjectId(),
                txHash: txHashFor("1")
            });
            await cleanupUser(userId);
            await PaymentIntent.create(firstIntent);

            await assert.rejects(() => PaymentIntent.create(secondIntent), /E11000/);
            await paymentSettlementService.settlePaymentIntent({ paymentIntentId: firstIntent._id, userId });

            const wallet = await Wallet.findOne({ userId }).lean();
            await assert.rejects(() => WalletTransaction.create({
                userId,
                walletId: wallet._id,
                type: "CREDIT",
                amount: 750,
                balanceBefore: 750,
                balanceAfter: 1500,
                reservedBefore: 0,
                reservedAfter: 0,
                referenceType: "paymentintent",
                referenceId: String(firstIntent._id),
                paymentIntentId: firstIntent._id,
                paymentMethodId: firstIntent.paymentMethodId,
                namespace: firstIntent.namespace,
                networkId: firstIntent.networkId,
                chainId: 8453,
                txHash: firstIntent.txHash,
                idempotencyKey: `duplicate-${firstIntent._id}`
            }), /E11000/);

            const credits = await WalletTransaction.find({ userId, type: "CREDIT" }).lean();
            assert.equal(credits.length, 1);
            assert.equal(wallet.balance, 750);
        });

        await t.test("concurrent different PaymentIntents preserve serialized ledger snapshots", async () => {
            const userId = new mongoose.Types.ObjectId();
            const firstIntent = createIntentDocument({ userId, txHash: txHashFor("2"), creditAmount: 750 });
            const secondIntent = createIntentDocument({
                userId,
                paymentIntentId: new mongoose.Types.ObjectId(),
                txHash: txHashFor("3"),
                creditAmount: 1800
            });
            await cleanupUser(userId);
            await Wallet.create({ userId, balance: 100, reserved: 25 });
            await PaymentIntent.create([firstIntent, secondIntent]);

            const results = await Promise.all([
                paymentSettlementService.settlePaymentIntent({ paymentIntentId: firstIntent._id, userId }),
                paymentSettlementService.settlePaymentIntent({ paymentIntentId: secondIntent._id, userId })
            ]);

            assert(results.every(result => result.created === true));

            const wallet = await Wallet.findOne({ userId }).lean();
            const credits = await WalletTransaction.find({ userId, type: "CREDIT" }).lean();

            assert.equal(wallet.balance, 2650);
            assert.equal(wallet.reserved, 25);
            assert.equal(credits.length, 2);
            assertSerializedCreditTransitions({
                credits,
                initialBalance: 100,
                finalBalance: 2650,
                expectedAmounts: [750, 1800]
            });
        });
    } finally {
        await mongoose.disconnect();
    }
});
