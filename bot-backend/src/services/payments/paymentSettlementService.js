const mongoose = require("mongoose");
const PaymentIntent = require("../../models/PaymentIntent");
const Wallet = require("../../models/Wallet");
const WalletTransaction = require("../../models/WalletTransaction");
const { aiCreditUnit } = require("../../config/config");
const { conflict, notFound, unavailable } = require("../../utils/errors");

const eligibleStatuses = new Set(["CONFIRMED", "CONFIRMED_OVERPAID"]);
const canonicalDecimalStringPattern = /^(0|[1-9][0-9]*)$/;

const addSession = (query, session) => session ? query.session(session) : query;
const idsEqual = (left, right) => String(left || "") === String(right || "");
const paymentCreditKey = (paymentIntentId) => `payment:${paymentIntentId}:credit`;

const isDuplicateKey = (error) => error?.code === 11000;
const hasErrorLabel = (error, label) => typeof error?.hasErrorLabel === "function" && error.hasErrorLabel(label);

const assertPositiveSafeInteger = (value, code, message) => {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw conflict(code, message);
    }
};

const assertCanonicalPositiveDecimalString = (value, code, message) => {
    if (typeof value !== "string" || !canonicalDecimalStringPattern.test(value) || BigInt(value) <= 0n) {
        throw conflict(code, message);
    }
};

const assertNonNegativeInteger = (value, code, message) => {
    if (!Number.isInteger(value) || value < 0) {
        throw conflict(code, message);
    }
};

const assertSettlementEligible = (intent) => {
    if (!eligibleStatuses.has(intent.status)) {
        throw conflict("PAYMENT_NOT_ELIGIBLE", "Payment intent is not eligible for settlement");
    }

    if (typeof intent.txHash !== "string" || !/^0x[a-f0-9]{64}$/.test(intent.txHash)) {
        throw conflict("PAYMENT_NOT_ELIGIBLE", "Payment intent is missing verified transaction hash");
    }

    assertNonNegativeInteger(intent.confirmedBlock, "PAYMENT_NOT_ELIGIBLE", "Payment intent is missing confirmed block");
    assertNonNegativeInteger(intent.confirmationCount, "PAYMENT_NOT_ELIGIBLE", "Payment intent is missing confirmation count");

    if (intent.transactionStatus !== "SUCCESS") {
        throw conflict("PAYMENT_NOT_ELIGIBLE", "Payment intent transaction is not successful");
    }

    assertCanonicalPositiveDecimalString(
        intent.expectedTokenAmountBaseUnits,
        "PAYMENT_ACCOUNTING_INVARIANT_FAILED",
        "Payment intent expected amount is invalid"
    );
    assertCanonicalPositiveDecimalString(
        intent.verifiedTokenAmountBaseUnits,
        "PAYMENT_NOT_ELIGIBLE",
        "Payment intent verified amount is missing"
    );
    assertPositiveSafeInteger(
        intent.creditAmount,
        "PAYMENT_ACCOUNTING_INVARIANT_FAILED",
        "Payment intent credit amount is invalid"
    );
};

const calculateOverpaidAmountBaseUnits = (intent) => {
    const expected = BigInt(intent.expectedTokenAmountBaseUnits);
    const verified = BigInt(intent.verifiedTokenAmountBaseUnits);
    const overpaid = verified - expected;

    if (intent.status === "CONFIRMED_OVERPAID") {
        if (overpaid <= 0n) {
            throw conflict("PAYMENT_ACCOUNTING_INVARIANT_FAILED", "Confirmed overpaid intent has no overpayment");
        }
        return overpaid.toString();
    }

    if (overpaid !== 0n) {
        throw conflict("PAYMENT_ACCOUNTING_INVARIANT_FAILED", "Confirmed intent amount does not match expected amount");
    }

    return null;
};

const assertCreditMatchesIntent = (credit, intent) => {
    if (
        !credit ||
        credit.type !== "CREDIT" ||
        !idsEqual(credit.paymentIntentId, intent._id) ||
        credit.chainId !== intent.chainId ||
        credit.txHash !== intent.txHash ||
        credit.amount !== intent.creditAmount
    ) {
        throw conflict("PAYMENT_ACCOUNTING_INVARIANT_FAILED", "Existing payment credit does not match payment intent");
    }
};

const toSettlementDto = ({ intent, wallet, transaction, created }) => ({
    settled: true,
    created,
    paymentIntent: {
        id: String(intent._id),
        status: intent.status,
        creditedTransactionId: String(transaction._id),
        overpaidAmountBaseUnits: intent.overpaidAmountBaseUnits || null,
        confirmedAt: intent.confirmedAt || null
    },
    wallet: {
        id: String(wallet._id),
        userId: String(wallet.userId),
        balance: wallet.balance,
        reserved: wallet.reserved,
        unit: wallet.unit
    },
    transaction: {
        id: String(transaction._id),
        type: transaction.type,
        amount: transaction.amount,
        idempotencyKey: transaction.idempotencyKey,
        paymentIntentId: String(transaction.paymentIntentId),
        chainId: transaction.chainId,
        txHash: transaction.txHash
    }
});

const createPaymentSettlementService = ({
    PaymentIntentModel = PaymentIntent,
    WalletModel = Wallet,
    TransactionModel = WalletTransaction,
    withTransaction = (callback) => mongoose.connection.transaction(callback),
    now = () => new Date()
} = {}) => {
    const getOrCreateWallet = async (userId, { session } = {}) => addSession(WalletModel.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId, balance: 0, reserved: 0, unit: aiCreditUnit } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ), session);

    const findPaymentCreditByKey = async (idempotencyKey, { session } = {}) => (
        addSession(TransactionModel.findOne({ idempotencyKey }), session)
    );

    const findPaymentCreditByTx = async ({ chainId, txHash }, { session } = {}) => (
        addSession(TransactionModel.findOne({ chainId, txHash, type: "CREDIT" }), session)
    );

    const findPaymentCreditByPaymentIntent = async (paymentIntentId, { session } = {}) => (
        addSession(TransactionModel.findOne({ paymentIntentId, type: "CREDIT" }), session)
    );

    const attachCreditToIntent = async ({ intent, credit, overpaidAmountBaseUnits, confirmedAt }, { session } = {}) => {
        if (intent.creditedTransactionId) {
            assertCreditMatchesIntent(credit, intent);
            return intent;
        }

        const update = await addSession(PaymentIntentModel.findOneAndUpdate(
            { _id: intent._id, userId: intent.userId, creditedTransactionId: null },
            {
                $set: {
                    creditedTransactionId: credit._id,
                    overpaidAmountBaseUnits,
                    confirmedAt: intent.confirmedAt || confirmedAt
                }
            },
            { new: true }
        ), session);

        if (!update) {
            const latest = await addSession(PaymentIntentModel.findOne({ _id: intent._id, userId: intent.userId }), session);
            if (latest?.creditedTransactionId && idsEqual(latest.creditedTransactionId, credit._id)) {
                return latest;
            }
            throw conflict("PAYMENT_ALREADY_SETTLED", "Payment intent was already settled");
        }

        return update;
    };

    const settlePaymentIntent = async ({ paymentIntentId, userId }) => {
        try {
            return await withTransaction(async (session) => {
                const intent = await addSession(PaymentIntentModel.findOne({ _id: paymentIntentId, userId }), session);
                if (!intent) {
                    throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
                }

                const idempotencyKey = paymentCreditKey(intent._id);

                if (intent.creditedTransactionId) {
                    const existingCredit = await addSession(TransactionModel.findOne({ _id: intent.creditedTransactionId }), session);
                    assertCreditMatchesIntent(existingCredit, intent);
                    const wallet = await getOrCreateWallet(intent.userId, { session });
                    return toSettlementDto({ intent, wallet, transaction: existingCredit, created: false });
                }

                assertSettlementEligible(intent);
                const overpaidAmountBaseUnits = calculateOverpaidAmountBaseUnits(intent);

                const txDuplicate = await findPaymentCreditByTx({ chainId: intent.chainId, txHash: intent.txHash }, { session });
                if (txDuplicate && !idsEqual(txDuplicate.paymentIntentId, intent._id)) {
                    throw conflict("PAYMENT_DUPLICATE_TX", "Blockchain transaction has already credited another payment intent");
                }
                if (txDuplicate) {
                    assertCreditMatchesIntent(txDuplicate, intent);
                    const confirmedAt = now();
                    const updatedIntent = await attachCreditToIntent({
                        intent,
                        credit: txDuplicate,
                        overpaidAmountBaseUnits,
                        confirmedAt
                    }, { session });
                    const wallet = await getOrCreateWallet(intent.userId, { session });
                    return toSettlementDto({ intent: updatedIntent, wallet, transaction: txDuplicate, created: false });
                }

                const existingCredit = await findPaymentCreditByKey(idempotencyKey, { session });
                if (existingCredit) {
                    assertCreditMatchesIntent(existingCredit, intent);
                    const confirmedAt = now();
                    const updatedIntent = await attachCreditToIntent({
                        intent,
                        credit: existingCredit,
                        overpaidAmountBaseUnits,
                        confirmedAt
                    }, { session });
                    const wallet = await getOrCreateWallet(intent.userId, { session });
                    return toSettlementDto({ intent: updatedIntent, wallet, transaction: existingCredit, created: false });
                }

                const metadata = {
                    source: "payment",
                    packageId: intent.packageId,
                    pricingVersion: intent.pricingVersion,
                    tokenSymbol: intent.tokenSymbol,
                    tokenAddress: intent.tokenAddress,
                    expectedTokenAmountBaseUnits: intent.expectedTokenAmountBaseUnits,
                    verifiedTokenAmountBaseUnits: intent.verifiedTokenAmountBaseUnits,
                    overpaidAmountBaseUnits,
                    confirmedBlock: intent.confirmedBlock,
                    confirmationCount: intent.confirmationCount
                };

                await getOrCreateWallet(intent.userId, { session });
                const walletBefore = await addSession(WalletModel.findOneAndUpdate(
                    { userId: intent.userId },
                    { $inc: { balance: intent.creditAmount } },
                    { new: false }
                ), session);
                const wallet = await addSession(WalletModel.findOne({ userId: intent.userId }), session);

                if (!walletBefore || !wallet) {
                    throw unavailable("PAYMENT_TRANSACTION_ABORTED", "Payment wallet update failed");
                }

                const balanceBefore = walletBefore.balance;
                const reservedBefore = walletBefore.reserved;

                let credit;
                try {
                    [credit] = await TransactionModel.create([{
                        userId: intent.userId,
                        walletId: wallet._id,
                        type: "CREDIT",
                        amount: intent.creditAmount,
                        unit: wallet.unit,
                        balanceBefore,
                        balanceAfter: balanceBefore + intent.creditAmount,
                        reservedBefore,
                        reservedAfter: reservedBefore,
                        referenceType: "paymentintent",
                        referenceId: String(intent._id),
                        paymentIntentId: intent._id,
                        chainId: intent.chainId,
                        txHash: intent.txHash,
                        idempotencyKey,
                        metadata
                    }], session ? { session } : undefined);
                } catch (error) {
                    if (isDuplicateKey(error)) {
                        const duplicate = await findPaymentCreditByKey(idempotencyKey, { session });
                        if (duplicate) {
                            assertCreditMatchesIntent(duplicate, intent);
                        }

                        const duplicateByIntent = await findPaymentCreditByPaymentIntent(intent._id, { session });
                        if (duplicateByIntent) {
                            assertCreditMatchesIntent(duplicateByIntent, intent);
                        }

                        const duplicateByTx = await findPaymentCreditByTx({ chainId: intent.chainId, txHash: intent.txHash }, { session });
                        if (duplicateByTx) {
                            assertCreditMatchesIntent(duplicateByTx, intent);
                        }

                        throw conflict("PAYMENT_DUPLICATE_CREDIT", "Payment credit already exists");
                    }
                    throw error;
                }

                const confirmedAt = now();
                const updatedIntent = await attachCreditToIntent({
                    intent,
                    credit,
                    overpaidAmountBaseUnits,
                    confirmedAt
                }, { session });

                return toSettlementDto({ intent: updatedIntent, wallet, transaction: credit, created: true });
            });
        } catch (error) {
            if (hasErrorLabel(error, "UnknownTransactionCommitResult")) {
                throw unavailable("PAYMENT_UNKNOWN_COMMIT_RESULT", "Payment settlement commit result is unknown");
            }
            if (hasErrorLabel(error, "TransientTransactionError")) {
                throw unavailable("PAYMENT_TRANSACTION_ABORTED", "Payment settlement transaction was aborted");
            }
            throw error;
        }
    };

    return { settlePaymentIntent };
};

module.exports = createPaymentSettlementService();
module.exports.createPaymentSettlementService = createPaymentSettlementService;
module.exports.paymentCreditKey = paymentCreditKey;
