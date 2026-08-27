const PaymentIntent = require("../../models/PaymentIntent");
const { paymentConfig } = require("../../config/config");
const { getPaymentMethodById } = require("../../config/paymentMethods");
const { conflict, unprocessable } = require("../../utils/errors");
const { calculateStablecoinBaseUnits, createPaymentPricingService } = require("./paymentPricingService");
const paymentPayerChallengeService = require("../payments/paymentPayerChallengeService");

const addSession = (query, session) => session ? query.session(session) : query;
const createPersistedPaymentMethodSnapshot = (paymentMethod) => ({
    id: paymentMethod.id,
    name: paymentMethod.name,
    namespace: paymentMethod.namespace || "eip155",
    network: paymentMethod.network,
    networkId: paymentMethod.networkId || (paymentMethod.chainId ? String(paymentMethod.chainId) : undefined),
    caipNetworkId: paymentMethod.caipNetworkId || ((paymentMethod.namespace || "eip155") === "solana"
        ? `solana:${paymentMethod.networkId}`
        : `eip155:${paymentMethod.chainId}`),
    cluster: paymentMethod.cluster,
    chainId: paymentMethod.chainId,
    assetType: paymentMethod.assetType || "erc20",
    assetProvenance: paymentMethod.assetProvenance,
    tokenAddress: paymentMethod.tokenAddress,
    mintAddress: paymentMethod.mintAddress,
    tokenSymbol: paymentMethod.tokenSymbol,
    tokenDecimals: paymentMethod.tokenDecimals,
    treasuryAddress: paymentMethod.treasuryAddress,
    confirmations: paymentMethod.confirmations,
    production: paymentMethod.production,
    testnet: paymentMethod.testnet,
    smoke: paymentMethod.smoke
});

const createPaymentIntentService = ({
    PaymentIntentModel = PaymentIntent,
    pricingService = createPaymentPricingService(),
    payerChallengeService = paymentPayerChallengeService,
    config = paymentConfig,
    configService = null,
    now = () => new Date()
} = {}) => {
    const createPaymentIntent = async ({ userId, packageId, paymentMethodId, idempotencyKey, payerChallengeId, signature }, { session } = {}) => {
        const existing = await addSession(PaymentIntentModel.findOne({ userId, idempotencyKey }), session);
        if (existing) {
            return { intent: existing, created: false };
        }

        const effectiveConfig = configService
            ? (await configService.getEffectivePaymentConfig()).config
            : config;
        const packageSnapshot = pricingService.getPackageSnapshot(packageId);
        const paymentMethod = getPaymentMethodById(effectiveConfig, paymentMethodId);
        if (!paymentMethod) {
            throw unprocessable("PAYMENT_METHOD_UNAVAILABLE", "Payment method is not available");
        }

        const payerProof = await payerChallengeService.verifyAndUseChallenge({
            userId,
            paymentMethodId: paymentMethod.id,
            payerChallengeId,
            signature
        }, { session });

        if ((payerProof.challenge.namespace || "eip155") !== (paymentMethod.namespace || "eip155")) {
            throw unprocessable("PAYER_CHALLENGE_WRONG_NAMESPACE", "Payer challenge does not match payment method");
        }
        if (
            payerProof.challenge.paymentMethodId !== paymentMethod.id ||
            payerProof.challenge.networkId !== (paymentMethod.networkId || String(paymentMethod.chainId)) ||
            payerProof.challenge.caipNetworkId !== paymentMethod.caipNetworkId
        ) {
            throw unprocessable("PAYER_CHALLENGE_WRONG_PAYMENT_METHOD", "Payer challenge does not match payment method");
        }

        const createdAt = now();
        const expiresAt = new Date(createdAt.getTime() + (effectiveConfig.intentTtlMinutes * 60 * 1000));
        const expectedTokenAmountBaseUnits = calculateStablecoinBaseUnits(
            packageSnapshot.expectedUsdAmountMinor,
            paymentMethod.tokenDecimals
        );
        const doc = {
            userId,
            idempotencyKey,
            packageId: packageSnapshot.packageId,
            paymentMethodId: paymentMethod.id,
            namespace: paymentMethod.namespace || "eip155",
            paymentMethodSnapshot: createPersistedPaymentMethodSnapshot(paymentMethod),
            networkId: paymentMethod.networkId || String(paymentMethod.chainId),
            chainId: paymentMethod.chainId,
            tokenAddress: paymentMethod.tokenAddress,
            mintAddress: paymentMethod.mintAddress,
            tokenSymbol: paymentMethod.tokenSymbol,
            tokenDecimals: paymentMethod.tokenDecimals,
            recipientAddress: paymentMethod.treasuryAddress,
            expectedTokenAmountBaseUnits,
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
