const PaymentIntent = require("../../models/PaymentIntent");
const { paymentConfig } = require("../../config/config");
const { conflict } = require("../../utils/errors");
const { createPaymentPricingService } = require("./paymentPricingService");
const paymentPayerChallengeService = require("../payments/paymentPayerChallengeService");

const addSession = (query, session) => session ? query.session(session) : query;

const createPaymentIntentService = ({
    PaymentIntentModel = PaymentIntent,
    pricingService = createPaymentPricingService(),
    payerChallengeService = paymentPayerChallengeService,
    config = paymentConfig,
    now = () => new Date()
} = {}) => {
    const createPaymentIntent = async ({ userId, packageId, idempotencyKey, payerChallengeId, signature }, { session } = {}) => {
        const existing = await addSession(PaymentIntentModel.findOne({ userId, idempotencyKey }), session);
        if (existing) {
            return { intent: existing, created: false };
        }

        const packageSnapshot = pricingService.getPackageSnapshot(packageId);
        const payerProof = await payerChallengeService.verifyAndUseChallenge({
            userId,
            payerChallengeId,
            signature
        }, { session });

        const createdAt = now();
        const expiresAt = new Date(createdAt.getTime() + (config.intentTtlMinutes * 60 * 1000));
        const doc = {
            userId,
            idempotencyKey,
            packageId: packageSnapshot.packageId,
            chainId: config.chainId,
            tokenAddress: config.tokenAddress,
            tokenSymbol: config.tokenSymbol,
            tokenDecimals: config.tokenDecimals,
            recipientAddress: config.treasuryAddress,
            expectedTokenAmountBaseUnits: packageSnapshot.expectedTokenAmountBaseUnits,
            expectedUsdAmountMinor: packageSnapshot.expectedUsdAmountMinor,
            creditAmount: packageSnapshot.creditAmount,
            pricingVersion: packageSnapshot.pricingVersion,
            payerAddress: payerProof.payerAddress,
            payerChallengeId: payerProof.challenge._id,
            expiresAt
        };

        try {
            const createOptions = session ? { session } : undefined;
            const [intent] = await PaymentIntentModel.create([doc], createOptions);
            return { intent, created: true };
        } catch (error) {
            if (error.code === 11000) {
                const duplicate = await addSession(PaymentIntentModel.findOne({ userId, idempotencyKey }), session);
                if (duplicate) {
                    return { intent: duplicate, created: false };
                }

                throw conflict("PAYMENT_INTENT_CONFLICT", "Payment intent creation conflicted");
            }

            throw error;
        }
    };

    return { createPaymentIntent };
};

module.exports.createPaymentIntentService = createPaymentIntentService;
