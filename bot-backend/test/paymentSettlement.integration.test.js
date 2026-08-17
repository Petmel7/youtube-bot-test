const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const PaymentIntent = require("../src/models/PaymentIntent");
const Wallet = require("../src/models/Wallet");
const WalletTransaction = require("../src/models/WalletTransaction");
const paymentSettlementService = require("../src/services/payments/paymentSettlementService");

const mongoUri = process.env.PAYMENT_SETTLEMENT_INTEGRATION_MONGO_URI;

function assertTestDatabase(uri) {
    const { pathname } = new URL(uri);
    const databaseName = pathname.replace(/^\//, "");

    assert.ok(
        /test|integration/i.test(databaseName),
        "PAYMENT_SETTLEMENT_INTEGRATION_MONGO_URI must point to a test/integration database"
    );
}

test("payment settlement integration: idempotent credit and unique payment indexes", {
    skip: mongoUri ? false : "set PAYMENT_SETTLEMENT_INTEGRATION_MONGO_URI to run live MongoDB settlement coverage"
}, async () => {
    assertTestDatabase(mongoUri);

    await mongoose.connect(mongoUri);

    try {
        await Promise.all([
            PaymentIntent.syncIndexes(),
            Wallet.syncIndexes(),
            WalletTransaction.syncIndexes()
        ]);

        const userId = new mongoose.Types.ObjectId();
        const paymentIntentId = new mongoose.Types.ObjectId();
        const txHash = `0x${"a".repeat(64)}`;

        await Promise.all([
            PaymentIntent.deleteMany({ userId }),
            Wallet.deleteMany({ userId }),
            WalletTransaction.deleteMany({ userId })
        ]);

        await PaymentIntent.create({
            _id: paymentIntentId,
            userId,
            idempotencyKey: `integration-${paymentIntentId}`,
            packageId: "integration-pack",
            chainId: 8453,
            tokenAddress: `0x${"b".repeat(40)}`,
            tokenSymbol: "USDC",
            tokenDecimals: 6,
            recipientAddress: `0x${"c".repeat(40)}`,
            expectedTokenAmountBaseUnits: "5000000",
            expectedUsdAmountMinor: 500,
            creditAmount: 750,
            pricingVersion: "integration-test",
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

        const [first, second] = await Promise.all([
            paymentSettlementService.settlePaymentIntent({ paymentIntentId, userId }),
            paymentSettlementService.settlePaymentIntent({ paymentIntentId, userId })
        ]);

        assert.equal(first.wallet.balance, 750);
        assert.equal(second.wallet.balance, 750);

        const wallet = await Wallet.findOne({ userId }).lean();
        const credits = await WalletTransaction.find({ userId, paymentIntentId, type: "CREDIT" }).lean();
        const updatedIntent = await PaymentIntent.findById(paymentIntentId).lean();

        assert.equal(wallet.balance, 750);
        assert.equal(wallet.reserved, 0);
        assert.equal(credits.length, 1);
        assert.equal(String(updatedIntent.creditedTransactionId), String(credits[0]._id));

        await assert.rejects(
            () => WalletTransaction.create({
                userId,
                walletId: wallet._id,
                type: "CREDIT",
                amount: 750,
                balanceBefore: 750,
                balanceAfter: 1500,
                reservedBefore: 0,
                reservedAfter: 0,
                referenceType: "paymentintent",
                referenceId: String(paymentIntentId),
                paymentIntentId,
                chainId: 8453,
                txHash,
                idempotencyKey: `duplicate-${paymentIntentId}`
            }),
            /E11000/
        );
    } finally {
        await mongoose.disconnect();
    }
});
