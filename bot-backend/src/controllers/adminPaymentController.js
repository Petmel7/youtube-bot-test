const defaultAdminPaymentObservabilityService = require("../services/payments/adminPaymentObservabilityService");
const defaultPaymentReconciliationService = require("../services/payments/paymentReconciliationService");
const defaultPaymentConfigService = require("../services/payments/paymentConfigService");
const {
    toAdminPaymentReconciliationCandidateDto,
    toAdminPaymentIntentDto,
    toAdminPaymentLedgerDto,
    toAdminPaymentMethodDto,
    toPaymentConfigProposalDto,
    toPaymentAuditLogDto,
    toPaymentSettlementDto
} = require("../utils/dto");
const { assertObjectBody, validatePaymentIntentId } = require("../utils/validators");
const { CONFIRMATION_PHRASE } = require("../services/payments/paymentConfigService");

const createAdminPaymentController = (
    adminPaymentObservabilityService = defaultAdminPaymentObservabilityService,
    paymentReconciliationService = defaultPaymentReconciliationService,
    paymentConfigService = defaultPaymentConfigService
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

    const getPaymentConfigController = async (req, res) => {
        const config = await paymentConfigService.getCurrentConfigSummary();

        res.json({
            success: true,
            config
        });
    };

    const listPaymentConfigProposalsController = async (req, res) => {
        const { proposals, limit } = await paymentConfigService.listProposals({
            status: req.query.status,
            limit: req.query.limit
        });

        res.json({
            success: true,
            proposals: proposals.map(proposal => toPaymentConfigProposalDto(proposal)),
            limit
        });
    };

    const createPaymentConfigProposalController = async (req, res) => {
        assertObjectBody(req.body);

        const proposal = await paymentConfigService.createProposal({
            actorUserId: req.user?._id || req.user?.id,
            reason: req.body.reason,
            methodChanges: req.body.methodChanges
        });

        res.status(201).json({
            success: true,
            proposal: toPaymentConfigProposalDto(proposal),
            requiredConfirmationPhrase: CONFIRMATION_PHRASE
        });
    };

    const getPaymentConfigProposalController = async (req, res) => {
        const proposalId = validatePaymentIntentId(req.params.id);
        const proposal = await paymentConfigService.findProposal(proposalId);
        const audits = await paymentConfigService.listAudits(proposal._id);

        res.json({
            success: true,
            proposal: toPaymentConfigProposalDto(proposal, { audits })
        });
    };

    const confirmPaymentConfigProposalController = async (req, res) => {
        assertObjectBody(req.body);
        const proposalId = validatePaymentIntentId(req.params.id);
        const proposal = await paymentConfigService.confirmProposal({
            proposalId,
            actorUserId: req.user?._id || req.user?.id,
            confirmationPhrase: req.body.confirmationPhrase
        });

        res.json({ success: true, proposal: toPaymentConfigProposalDto(proposal) });
    };

    const approvePaymentConfigProposalController = async (req, res) => {
        const proposalId = validatePaymentIntentId(req.params.id);
        const proposal = await paymentConfigService.approveProposal({
            proposalId,
            actorUserId: req.user?._id || req.user?.id
        });

        res.json({ success: true, proposal: toPaymentConfigProposalDto(proposal) });
    };

    const activatePaymentConfigProposalController = async (req, res) => {
        const proposalId = validatePaymentIntentId(req.params.id);
        const { proposal, active } = await paymentConfigService.activateProposal({
            proposalId,
            actorUserId: req.user?._id || req.user?.id
        });

        res.json({
            success: true,
            proposal: toPaymentConfigProposalDto(proposal),
            activeConfig: {
                source: active.source,
                version: active.version,
                activatedProposalId: String(active.activatedProposalId)
            }
        });
    };

    const rejectPaymentConfigProposalController = async (req, res) => {
        assertObjectBody(req.body);
        const proposalId = validatePaymentIntentId(req.params.id);
        const proposal = await paymentConfigService.rejectProposal({
            proposalId,
            actorUserId: req.user?._id || req.user?.id,
            note: req.body.note
        });

        res.json({ success: true, proposal: toPaymentConfigProposalDto(proposal) });
    };

    const cancelPaymentConfigProposalController = async (req, res) => {
        assertObjectBody(req.body);
        const proposalId = validatePaymentIntentId(req.params.id);
        const proposal = await paymentConfigService.cancelProposal({
            proposalId,
            actorUserId: req.user?._id || req.user?.id,
            note: req.body.note
        });

        res.json({ success: true, proposal: toPaymentConfigProposalDto(proposal) });
    };

    return {
        getPaymentMethodsController,
        getPaymentIntentsController,
        getPaymentLedgerController,
        getPaymentReconciliationController,
        retryPaymentVerificationController,
        reviewPaymentIntentController,
        getPaymentConfigController,
        listPaymentConfigProposalsController,
        createPaymentConfigProposalController,
        getPaymentConfigProposalController,
        confirmPaymentConfigProposalController,
        approvePaymentConfigProposalController,
        activatePaymentConfigProposalController,
        rejectPaymentConfigProposalController,
        cancelPaymentConfigProposalController
    };
};

module.exports = {
    ...createAdminPaymentController(),
    createAdminPaymentController
};
