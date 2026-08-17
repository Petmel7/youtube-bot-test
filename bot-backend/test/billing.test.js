const test = require("node:test");
const assert = require("node:assert/strict");

const { createLedgerService } = require("../src/services/billing/ledgerService");
const { createWalletService } = require("../src/services/billing/walletService");
const {
    calculateActualAiCost,
    calculateCredits,
    estimateInputTokens
} = require("../src/services/billing/costEstimator");

const query = (value) => ({
    session() {
        return this;
    },
    then(resolve, reject) {
        return Promise.resolve(value).then(resolve, reject);
    }
});

const clone = (value) => value ? { ...value } : null;

const createFakeWalletModel = () => {
    const wallets = new Map();

    const matches = (wallet, filter) => {
        if (filter.reserved?.$gte !== undefined && wallet.reserved < filter.reserved.$gte) return false;
        if (filter.balance?.$gte !== undefined && wallet.balance < filter.balance.$gte) return false;
        if (filter.$expr) {
            const available = wallet.balance - wallet.reserved;
            const required = filter.$expr.$gte[1];
            if (available < required) return false;
        }
        return true;
    };

    return {
        wallets,
        findOneAndUpdate(filter, update, options = {}) {
            let wallet = wallets.get(String(filter.userId));
            if (!wallet && options.upsert) {
                wallet = {
                    _id: `${filter.userId}-wallet`,
                    userId: filter.userId,
                    balance: update.$setOnInsert?.balance || 0,
                    reserved: update.$setOnInsert?.reserved || 0,
                    unit: update.$setOnInsert?.unit || "AI_CREDIT"
                };
                wallets.set(String(filter.userId), wallet);
            }
            if (!wallet || !matches(wallet, filter)) return query(null);

            const before = clone(wallet);
            if (update.$inc?.balance) wallet.balance += update.$inc.balance;
            if (update.$inc?.reserved) wallet.reserved += update.$inc.reserved;

            return query(options.new ? clone(wallet) : before);
        },
        findOne(filter) {
            return query(clone(wallets.get(String(filter.userId))));
        }
    };
};

const createFakeTransactionModel = () => {
    const transactions = new Map();

    return {
        transactions,
        findOne(filter) {
            return query(clone(transactions.get(filter.idempotencyKey)));
        },
        async create(entries) {
            return entries.map(entry => {
                if (transactions.has(entry.idempotencyKey)) {
                    const error = new Error("duplicate key");
                    error.code = 11000;
                    throw error;
                }
                const doc = { _id: `${entry.idempotencyKey}-tx`, ...entry };
                transactions.set(entry.idempotencyKey, doc);
                return clone(doc);
            });
        }
    };
};

const createTestWalletService = () => {
    const WalletModel = createFakeWalletModel();
    const TransactionModel = createFakeTransactionModel();
    const ledgerService = createLedgerService({ TransactionModel });
    const service = createWalletService({
        WalletModel,
        ledgerService,
        withTransaction: async callback => callback(null)
    });

    return { service, WalletModel, TransactionModel };
};

test("cost estimator uses integer credits and rejects missing actual usage", () => {
    assert.equal(estimateInputTokens({ comment: "abcd", prompt: "efgh" }), 2);
    assert.equal(calculateCredits({ promptTokens: 2, outputTokens: 3 }), 14);
    assert.deepEqual(calculateActualAiCost({
        usage: { promptTokens: 2, outputTokens: 3, totalTokens: 5 }
    }), {
        promptTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
        credits: 14
    });
    assert.throws(() => calculateActualAiCost({ usage: { promptTokens: null, outputTokens: 3 } }), {
        code: "ACCOUNTING_USAGE_MISSING"
    });
});

test("wallet creation and development credit grant are idempotent", async () => {
    const { service, TransactionModel } = createTestWalletService();

    const first = await service.grantDevelopmentCredits({
        userId: "user-1",
        amount: 100,
        idempotencyKey: "grant-1"
    });
    const second = await service.grantDevelopmentCredits({
        userId: "user-1",
        amount: 100,
        idempotencyKey: "grant-1"
    });

    assert.equal(first.wallet.balance, 100);
    assert.equal(second.wallet.balance, 100);
    assert.equal(TransactionModel.transactions.size, 1);
});

test("reservation is atomic and rejects insufficient credits", async () => {
    const { service } = createTestWalletService();

    await service.grantDevelopmentCredits({ userId: "user-1", amount: 100, idempotencyKey: "grant-1" });
    const reservation = await service.reserveCredits({
        userId: "user-1",
        amount: 80,
        idempotencyKey: "reserve-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    });

    assert.equal(reservation.wallet.balance, 100);
    assert.equal(reservation.wallet.reserved, 80);
    await assert.rejects(() => service.reserveCredits({
        userId: "user-1",
        amount: 30,
        idempotencyKey: "reserve-2",
        referenceType: "aiusage",
        referenceId: "op-2"
    }), { code: "INSUFFICIENT_CREDITS" });
});

test("duplicate reservation does not reserve credits twice", async () => {
    const { service, TransactionModel } = createTestWalletService();

    await service.grantDevelopmentCredits({ userId: "user-1", amount: 100, idempotencyKey: "grant-1" });
    await service.reserveCredits({
        userId: "user-1",
        amount: 80,
        idempotencyKey: "reserve-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    });
    const duplicate = await service.reserveCredits({
        userId: "user-1",
        amount: 80,
        idempotencyKey: "reserve-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    });

    assert.equal(duplicate.created, false);
    assert.equal(duplicate.wallet.reserved, 80);
    assert.equal(TransactionModel.transactions.size, 2);
});

test("successful finalization debits actual credits and releases unused reservation", async () => {
    const { service } = createTestWalletService();

    await service.grantDevelopmentCredits({ userId: "user-1", amount: 100, idempotencyKey: "grant-1" });
    await service.reserveCredits({
        userId: "user-1",
        amount: 80,
        idempotencyKey: "reserve-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    });
    const result = await service.finalizeCharge({
        userId: "user-1",
        reservedAmount: 80,
        actualAmount: 63,
        debitKey: "debit-1",
        releaseKey: "release-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    });

    assert.equal(result.wallet.balance, 37);
    assert.equal(result.wallet.reserved, 0);
    assert.equal(result.debit.amount, 63);
    assert.equal(result.release.amount, 17);
});

test("finalization rejects actual charge above reserved credits", async () => {
    const { service } = createTestWalletService();

    await service.grantDevelopmentCredits({ userId: "user-1", amount: 100, idempotencyKey: "grant-1" });
    await service.reserveCredits({
        userId: "user-1",
        amount: 50,
        idempotencyKey: "reserve-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    });

    await assert.rejects(() => service.finalizeCharge({
        userId: "user-1",
        reservedAmount: 50,
        actualAmount: 51,
        debitKey: "debit-1",
        releaseKey: "release-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    }), { code: "ACCOUNTING_ESTIMATE_EXCEEDED" });
});

test("provider failure releases reservation without debit", async () => {
    const { service, TransactionModel } = createTestWalletService();

    await service.grantDevelopmentCredits({ userId: "user-1", amount: 100, idempotencyKey: "grant-1" });
    await service.reserveCredits({
        userId: "user-1",
        amount: 80,
        idempotencyKey: "reserve-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    });
    const result = await service.releaseReservation({
        userId: "user-1",
        amount: 80,
        idempotencyKey: "release-1",
        referenceType: "aiusage",
        referenceId: "op-1"
    });

    assert.equal(result.wallet.balance, 100);
    assert.equal(result.wallet.reserved, 0);
    assert.equal([...TransactionModel.transactions.values()].some(tx => tx.type === "DEBIT"), false);
});

test("two simultaneous reservations cannot overdraw available credits", async () => {
    const { service } = createTestWalletService();

    await service.grantDevelopmentCredits({ userId: "user-1", amount: 100, idempotencyKey: "grant-1" });
    const results = await Promise.allSettled([
        service.reserveCredits({
            userId: "user-1",
            amount: 80,
            idempotencyKey: "reserve-1",
            referenceType: "aiusage",
            referenceId: "op-1"
        }),
        service.reserveCredits({
            userId: "user-1",
            amount: 80,
            idempotencyKey: "reserve-2",
            referenceType: "aiusage",
            referenceId: "op-2"
        })
    ]);

    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(result => result.status === "rejected").length, 1);
});
