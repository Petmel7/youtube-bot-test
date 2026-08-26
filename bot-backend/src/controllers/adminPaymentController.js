const defaultAdminPaymentObservabilityService = require("../services/payments/adminPaymentObservabilityService");
const {
    toAdminPaymentIntentDto,
    toAdminPaymentLedgerDto,
    toAdminPaymentMethodDto
} = require("../utils/dto");

const createAdminPaymentController = (
    adminPaymentObservabilityService = defaultAdminPaymentObservabilityService
) => {
    const getPaymentMethodsController = async (req, res) => {
        const { paymentMethods } = await adminPaymentObservabilityService.listPaymentMethods();

        res.json({
            success: true,
            paymentMethods: paymentMethods.map(toAdminPaymentMethodDto)
        });
    };

    const getPaymentIntentsController = async (req, res) => {
        const result = await adminPaymentObservabilityService.listRecentPaymentIntents({
            status: req.query.status,
            methodId: req.query.methodId,
            limit: req.query.limit,
            cursor: req.query.cursor
        });

        res.json({
            success: true,
            intents: result.items.map(toAdminPaymentIntentDto),
            nextCursor: result.nextCursor,
            limit: result.limit
        });
    };

    const getPaymentLedgerController = async (req, res) => {
        const result = await adminPaymentObservabilityService.listRecentLedgerEntries({
            type: req.query.type,
            limit: req.query.limit,
            cursor: req.query.cursor
        });

        res.json({
            success: true,
            ledger: result.items.map(toAdminPaymentLedgerDto),
            nextCursor: result.nextCursor,
            limit: result.limit
        });
    };

    return {
        getPaymentMethodsController,
        getPaymentIntentsController,
        getPaymentLedgerController
    };
};

module.exports = {
    ...createAdminPaymentController(),
    createAdminPaymentController
};
