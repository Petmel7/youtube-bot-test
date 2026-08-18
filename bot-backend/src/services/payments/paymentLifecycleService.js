const PaymentIntent = require("../../models/PaymentIntent");
const { paymentConfig } = require("../../config/config");
const { conflict, notFound, unavailable } = require("../../utils/errors");
const { createPaymentIntentService } = require("../billing/paymentIntentService");
const paymentSettlementService = require("./paymentSettlementService");
const { createPaymentVerifier, PAYMENT_OUTCOMES } = require("./paymentVerifier");

const addSession = (query, session) => session ? query.session(session) : query;

const terminalStatuses = new Set(["UNDERPAID", "EXPIRED", "FAILED", "REJECTED", "CANCELLED"]);
const settlementStatuses = new Set(["CONFIRMED", "CONFIRMED_OVERPAID"]);
const retryableStatuses = new Set(["PENDING", "SUBMITTED", "VERIFYING", "CONFIRMING"]);

const statusForOutcome = (outcome) => {
    if (outcome === PAYMENT_OUTCOMES.PENDING) return "SUBMITTED";
    if (outcome === PAYMENT_OUTCOMES.CONFIRMING) return "CONFIRMING";
    if (outcome === PAYMENT_OUTCOMES.VERIFIED) return "CONFIRMED";
    if (outcome === PAYMENT_OUTCOMES.OVERPAID) return "CONFIRMED_OVERPAID";
    if (outcome === PAYMENT_OUTCOMES.UNDERPAID) return "UNDERPAID";
    if (outcome === PAYMENT_OUTCOMES.REJECTED) return "REJECTED";
    return "FAILED";
};

const failureForOutcome = (result) => {
    if ([PAYMENT_OUTCOMES.PENDING, PAYMENT_OUTCOMES.CONFIRMING, PAYMENT_OUTCOMES.VERIFIED, PAYMENT_OUTCOMES.OVERPAID].includes(result.outcome)) {
        return { failureCode: null, failureReason: null };
    }

    return {
        failureCode: result.code || "PAYMENT_VERIFICATION_FAILED",
        failureReason: result.retryable ? "Payment verification is temporarily unavailable" : "Payment verification failed"
    };
};

const isExpired = (intent, now) => !intent.creditedTransactionId && intent.expiresAt && intent.expiresAt.getTime() <= now.getTime();

const createPaymentLifecycleService = ({
    PaymentIntentModel = PaymentIntent,
    paymentIntentService,
    paymentVerifier = createPaymentVerifier(),
    settlementService = paymentSettlementService,
    config = paymentConfig,
    now = () => new Date()
} = {}) => {
    const intentService = paymentIntentService || createPaymentIntentService({ PaymentIntentModel });

    const findOwnedIntent = async ({ userId, paymentIntentId }, { session } = {}) => (
        addSession(PaymentIntentModel.findOne({ _id: paymentIntentId, userId }), session)
    );

    const expireIfNeeded = async (intent) => {
        if (!intent || !isExpired(intent, now()) || settlementStatuses.has(intent.status) || terminalStatuses.has(intent.status)) {
            return intent;
        }

        const expired = await PaymentIntentModel.findOneAndUpdate(
            { _id: intent._id, userId: intent.userId, creditedTransactionId: null },
            { $set: { status: "EXPIRED", failureCode: "PAYMENT_EXPIRED", failureReason: "Payment intent expired" } },
            { new: true }
        );

        return expired || intent;
    };

    const createIntent = async ({ userId, packageId, idempotencyKey }) => {
        const result = await intentService.createPaymentIntent({ userId, packageId, idempotencyKey });
        return { intent: result.intent, created: result.created };
    };

    const getIntent = async ({ userId, paymentIntentId }) => {
        const intent = await findOwnedIntent({ userId, paymentIntentId });
        if (!intent) {
            throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
        }

        return { intent: await expireIfNeeded(intent) };
    };

    const associateTxHash = async ({ intent, txHash }) => {
        if (intent.txHash && intent.txHash !== txHash) {
            throw conflict("PAYMENT_TX_HASH_CONFLICT", "Payment intent already has a different transaction hash");
        }

        if (intent.txHash === txHash) {
            return intent;
        }

        try {
            const updated = await PaymentIntentModel.findOneAndUpdate(
                { _id: intent._id, userId: intent.userId, txHash: null },
                { $set: { txHash, status: "VERIFYING", failureCode: null, failureReason: null } },
                { new: true }
            );

            if (!updated) {
                const latest = await findOwnedIntent({ userId: intent.userId, paymentIntentId: intent._id });
                if (latest?.txHash === txHash) {
                    return latest;
                }
                throw conflict("PAYMENT_TX_HASH_CONFLICT", "Payment transaction hash could not be associated");
            }

            return updated;
        } catch (error) {
            if (error.code === 11000) {
                throw conflict("PAYMENT_DUPLICATE_TX", "Payment transaction hash is already associated");
            }
            throw error;
        }
    };

    const persistVerificationResult = async ({ intent, result }) => {
        const status = statusForOutcome(result.outcome);
        const failure = failureForOutcome(result);
        const update = {
            status,
            txHash: result.txHash || intent.txHash,
            fromAddress: result.fromAddress || null,
            firstSeenBlock: result.firstSeenBlock ?? null,
            confirmedBlock: result.confirmedBlock ?? null,
            confirmationCount: result.confirmationCount ?? null,
            verifiedTokenAmountBaseUnits: result.verifiedTokenAmountBaseUnits || null,
            transactionStatus: result.transactionStatus || null,
            failureCode: failure.failureCode,
            failureReason: failure.failureReason
        };

        if (settlementStatuses.has(status)) {
            update.confirmedAt = intent.confirmedAt || now();
        }

        return PaymentIntentModel.findOneAndUpdate(
            { _id: intent._id, userId: intent.userId },
            { $set: update },
            { new: true }
        );
    };

    const verifyIntent = async ({ userId, paymentIntentId, txHash }) => {
        let intent = await findOwnedIntent({ userId, paymentIntentId });
        if (!intent) {
            throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
        }

        intent = await expireIfNeeded(intent);
        if (intent.status === "EXPIRED") {
            return { intent, settlement: null };
        }

        if (intent.creditedTransactionId) {
            if (intent.txHash && intent.txHash !== txHash) {
                throw conflict("PAYMENT_TX_HASH_CONFLICT", "Payment intent already has a different transaction hash");
            }
            return { intent, settlement: null };
        }

        if (terminalStatuses.has(intent.status) && !retryableStatuses.has(intent.status)) {
            if (intent.txHash === txHash) {
                return { intent, settlement: null };
            }
            throw conflict("PAYMENT_NOT_VERIFIABLE", "Payment intent is not eligible for verification");
        }

        intent = await associateTxHash({ intent, txHash });
        const verification = await paymentVerifier.verifyPaymentIntent(intent);

        if (verification.retryable && verification.outcome === PAYMENT_OUTCOMES.REJECTED) {
            throw unavailable("PAYMENT_PROVIDER_FAILURE", "Payment verification provider is temporarily unavailable");
        }

        const updatedIntent = await persistVerificationResult({ intent, result: verification });
        if (!updatedIntent) {
            throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
        }

        if (settlementStatuses.has(updatedIntent.status)) {
            const settlement = await settlementService.settlePaymentIntent({ paymentIntentId: updatedIntent._id, userId });
            const settledIntent = await findOwnedIntent({ userId, paymentIntentId: updatedIntent._id });
            return { intent: settledIntent || updatedIntent, settlement };
        }

        return { intent: updatedIntent, settlement: null };
    };

    return {
        createIntent,
        getIntent,
        verifyIntent,
        requiredConfirmations: config.confirmations
    };
};

let defaultLifecycleService;
const getDefaultLifecycleService = () => {
    if (!defaultLifecycleService) {
        defaultLifecycleService = createPaymentLifecycleService();
    }
    return defaultLifecycleService;
};

const lazyDefaultLifecycleService = {
    get requiredConfirmations() {
        return paymentConfig.confirmations;
    },
    createIntent(...args) {
        return getDefaultLifecycleService().createIntent(...args);
    },
    getIntent(...args) {
        return getDefaultLifecycleService().getIntent(...args);
    },
    verifyIntent(...args) {
        return getDefaultLifecycleService().verifyIntent(...args);
    }
};

module.exports = lazyDefaultLifecycleService;
module.exports.createPaymentLifecycleService = createPaymentLifecycleService;
module.exports.statusForOutcome = statusForOutcome;
