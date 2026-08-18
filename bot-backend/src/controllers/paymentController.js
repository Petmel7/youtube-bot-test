const defaultPaymentLifecycleService = require("../services/payments/paymentLifecycleService");
const defaultWalletService = require("../services/billing/walletService");
const { createPaymentPricingService } = require("../services/billing/paymentPricingService");
const { toPaymentIntentDto, toPaymentPackageDto, toWalletDto } = require("../utils/dto");
const {
    assertObjectBody,
    validateIdempotencyKey,
    validatePaymentIntentId,
    validatePaymentPackageId,
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
        paymentPricingService = null
    } = {}
) => {
    const getPaymentPricingService = () => paymentPricingService || getDefaultPaymentPricingService();

    const getPaymentPackagesController = async (req, res) => {
        const packages = getPaymentPricingService().listPackageSnapshots();

        res.json({
            success: true,
            packages: packages.map(toPaymentPackageDto)
        });
    };

    const getWalletController = async (req, res) => {
        const wallet = await walletService.getWallet({ userId: getUserId(req) });

        res.json({
            success: true,
            wallet: toWalletDto(wallet)
        });
    };

    const createPaymentIntentController = async (req, res) => {
        assertObjectBody(req.body);

        const packageId = validatePaymentPackageId(req.body.packageId);
        const idempotencyKey = validateIdempotencyKey(req.get("Idempotency-Key") || req.body.idempotencyKey);
        const { intent, created } = await paymentLifecycleService.createIntent({
            userId: getUserId(req),
            packageId,
            idempotencyKey
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
            settlement: settlement || null
        });
    };

    return {
        getPaymentPackagesController,
        getWalletController,
        createPaymentIntentController,
        getPaymentIntentController,
        verifyPaymentIntentController
    };
};

module.exports = {
    ...createPaymentController(),
    createPaymentController
};
