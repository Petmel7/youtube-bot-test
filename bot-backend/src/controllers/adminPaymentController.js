const defaultAdminPaymentObservabilityService = require("../services/payments/adminPaymentObservabilityService");
const defaultPaymentReconciliationService = require("../services/payments/paymentReconciliationService");
const {
    toAdminPaymentReconciliationCandidateDto,
    toAdminPaymentIntentDto,
    toAdminPaymentLedgerDto,
    toAdminPaymentMethodDto,
    toPaymentAuditLogDto,
    toPaymentSettlementDto
} = require("../utils/dto");
const { assertObjectBody, validatePaymentIntentId } = require("../utils/validators");

const createAdminPaymentController = (
    adminPaymentObservabilityService = defaultAdminPaymentObservabilityService,
    paymentReconciliationService = defaultPaymentReconciliationService
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

    const getPaymentReconciliationController = async (req, res) => {
        const result = await paymentReconciliationService.listCandidates({
            status: req.query.status,
            methodId: req.query.methodId,
            reviewStatus: req.query.reviewStatus,
            limit: req.query.limit,
            cursor: req.query.cursor
        });

        res.json({
            success: true,
            candidates: result.items.map(toAdminPaymentReconciliationCandidateDto),
            nextCursor: result.nextCursor,
            limit: result.limit
        });
    };

    const retryPaymentVerificationController = async (req, res) => {
        const paymentIntentId = validatePaymentIntentId(req.params.id);
        const { intent, settlement } = await paymentReconciliationService.retryVerificationOrSettlement({
            paymentIntentId,
            actorUserId: req.user?._id || req.user?.id
        });

        res.json({
            success: true,
            intent: toAdminPaymentIntentDto(intent),
            settlement: toPaymentSettlementDto(settlement)
        });
    };

    const reviewPaymentIntentController = async (req, res) => {
        assertObjectBody(req.body);

        const paymentIntentId = validatePaymentIntentId(req.params.id);
        const { intent, audit } = await paymentReconciliationService.markReviewed({
            paymentIntentId,
            actorUserId: req.user?._id || req.user?.id,
            action: req.body.action,
            note: req.body.note
        });

        res.json({
            success: true,
            candidate: toAdminPaymentReconciliationCandidateDto({ intent, latestAudit: audit }),
            audit: toPaymentAuditLogDto(audit)
        });
    };

    return {
        getPaymentMethodsController,
        getPaymentIntentsController,
        getPaymentLedgerController,
        getPaymentReconciliationController,
        retryPaymentVerificationController,
        reviewPaymentIntentController
    };
};

module.exports = {
    ...createAdminPaymentController(),
    createAdminPaymentController
};
