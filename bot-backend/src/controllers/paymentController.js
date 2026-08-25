const defaultPaymentLifecycleService = require("../services/payments/paymentLifecycleService");
const defaultWalletService = require("../services/billing/walletService");
const { createPaymentPricingService } = require("../services/billing/paymentPricingService");
const { getEnabledPaymentMethods } = require("../config/paymentMethods");
const { paymentConfig } = require("../config/config");
const paymentPayerChallengeService = require("../services/payments/paymentPayerChallengeService");
const { toPaymentIntentDto, toPaymentMethodDto, toPaymentPackageDto, toPaymentPayerChallengeDto, toPaymentSettlementDto, toWalletDto } = require("../utils/dto");
const {
    assertObjectBody,
    validateEvmAddress,
    validateIdempotencyKey,
    validatePaymentIntentId,
    validatePaymentMethodId,
    validatePaymentPackageId,
    validatePaymentPayerChallengeId,
    validatePaymentSignature,
    validatePaymentTxHash
} = require("../utils/validators");

const getUserId = (req) => req.user?._id || req.user?.id;
let defaultPaymentPricingService;

const getDefaultPaymentPricingService = () => {
    if (!defaultPaymentPricingService) {
        defaultPaymentPricingService = createPaymentPricingService();
    }

    return defaultPaymentPricingService;
};

const createPaymentController = (
    paymentLifecycleService = defaultPaymentLifecycleService,
    {
        walletService = defaultWalletService,
        payerChallengeService = paymentPayerChallengeService,
        paymentPricingService = null,
        paymentMethods = null
    } = {}
) => {
    const getPaymentPricingService = () => paymentPricingService || getDefaultPaymentPricingService();

    const getPaymentPackagesController = async (req, res) => {
        const packages = getPaymentPricingService().listPackageSnapshots();
        const availablePaymentMethods = paymentMethods || getEnabledPaymentMethods(paymentConfig).filter(method => method.enabled);

        res.json({
            success: true,
            packages: packages.map(toPaymentPackageDto),
            paymentMethods: availablePaymentMethods.map(toPaymentMethodDto),
            defaultPaymentMethodId: paymentConfig.defaultMethodId || availablePaymentMethods[0]?.id || null
        });
    };

    const getWalletController = async (req, res) => {
        const wallet = await walletService.getWallet({ userId: getUserId(req) });

        res.json({
            success: true,
            wallet: toWalletDto(wallet)
        });
    };

    const createPayerChallengeController = async (req, res) => {
        assertObjectBody(req.body);

        const payerAddress = validateEvmAddress(req.body.payerAddress);
        const { challenge } = await payerChallengeService.createChallenge({
            userId: getUserId(req),
            payerAddress
        });

        res.status(201).json({
            success: true,
            challenge: toPaymentPayerChallengeDto(challenge)
        });
    };

    const createPaymentIntentController = async (req, res) => {
        assertObjectBody(req.body);

        const packageId = validatePaymentPackageId(req.body.packageId);
        const paymentMethodId = validatePaymentMethodId(req.body.paymentMethodId);
        const payerChallengeId = validatePaymentPayerChallengeId(req.body.payerChallengeId);
        const signature = validatePaymentSignature(req.body.signature);
        const idempotencyKey = validateIdempotencyKey(req.get("Idempotency-Key") || req.body.idempotencyKey);
        const { intent, created } = await paymentLifecycleService.createIntent({
            userId: getUserId(req),
            packageId,
            paymentMethodId,
            idempotencyKey,
            payerChallengeId,
            signature
        });

        res.status(created ? 201 : 200).json({
            success: true,
            intent: toPaymentIntentDto(intent, {
                requiredConfirmations: paymentLifecycleService.requiredConfirmations
            })
        });
    };

    const getPaymentIntentController = async (req, res) => {
        const paymentIntentId = validatePaymentIntentId(req.params.id);
        const { intent } = await paymentLifecycleService.getIntent({
            userId: getUserId(req),
            paymentIntentId
        });

        res.json({
            success: true,
            intent: toPaymentIntentDto(intent, {
                requiredConfirmations: paymentLifecycleService.requiredConfirmations
            })
        });
    };

    const verifyPaymentIntentController = async (req, res) => {
        assertObjectBody(req.body);

        const paymentIntentId = validatePaymentIntentId(req.params.id);
        const txHash = validatePaymentTxHash(req.body.txHash);
        const { intent, settlement } = await paymentLifecycleService.verifyIntent({
            userId: getUserId(req),
            paymentIntentId,
            txHash
        });

        res.json({
            success: true,
            intent: toPaymentIntentDto(intent, {
                requiredConfirmations: paymentLifecycleService.requiredConfirmations
            }),
            settlement: toPaymentSettlementDto(settlement)
        });
    };

    return {
        getPaymentPackagesController,
        getWalletController,
        createPayerChallengeController,
        createPaymentIntentController,
        getPaymentIntentController,
        verifyPaymentIntentController
    };
};

module.exports = {
    ...createPaymentController(),
    createPaymentController
};
