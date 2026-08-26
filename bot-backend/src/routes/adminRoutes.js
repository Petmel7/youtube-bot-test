const express = require("express");
const {
    createAdminPaymentController,
    getPaymentIntentsController,
    getPaymentLedgerController,
    getPaymentMethodsController,
    getPaymentReconciliationController,
    getPaymentConfigController,
    listPaymentConfigProposalsController,
    createPaymentConfigProposalController,
    getPaymentConfigProposalController,
    confirmPaymentConfigProposalController,
    approvePaymentConfigProposalController,
    activatePaymentConfigProposalController,
    rejectPaymentConfigProposalController,
    cancelPaymentConfigProposalController,
    retryPaymentVerificationController,
    reviewPaymentIntentController
} = require("../controllers/adminPaymentController");
const { isAuthenticated } = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const requireWriteHeader = require("../middleware/requireWriteHeader");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/payments/methods", isAuthenticated, requireAdmin, asyncHandler(getPaymentMethodsController));
router.get("/payments/intents", isAuthenticated, requireAdmin, asyncHandler(getPaymentIntentsController));
router.get("/payments/ledger", isAuthenticated, requireAdmin, asyncHandler(getPaymentLedgerController));
router.get("/payments/reconciliation", isAuthenticated, requireAdmin, asyncHandler(getPaymentReconciliationController));
router.get("/payments/config", isAuthenticated, requireAdmin, asyncHandler(getPaymentConfigController));
router.get("/payments/config/proposals", isAuthenticated, requireAdmin, asyncHandler(listPaymentConfigProposalsController));
router.post("/payments/config/proposals", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(createPaymentConfigProposalController));
router.get("/payments/config/proposals/:id", isAuthenticated, requireAdmin, asyncHandler(getPaymentConfigProposalController));
router.post("/payments/config/proposals/:id/confirm", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(confirmPaymentConfigProposalController));
router.post("/payments/config/proposals/:id/approve", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(approvePaymentConfigProposalController));
router.post("/payments/config/proposals/:id/activate", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(activatePaymentConfigProposalController));
router.post("/payments/config/proposals/:id/reject", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(rejectPaymentConfigProposalController));
router.post("/payments/config/proposals/:id/cancel", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(cancelPaymentConfigProposalController));
router.post("/payments/intents/:id/retry-verify", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(retryPaymentVerificationController));
router.post("/payments/intents/:id/review", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(reviewPaymentIntentController));

const normalizeAdminRouteDependencies = (dependencies) => {
    if (!dependencies || typeof dependencies !== "object") return {};
    if (typeof dependencies.listPaymentMethods === "function") {
        return { adminPaymentObservabilityService: dependencies };
    }
    return dependencies;
};

module.exports = router;
module.exports.createAdminRoutes = (dependencies) => {
    const {
        adminPaymentObservabilityService,
        paymentReconciliationService,
        paymentConfigService
    } = normalizeAdminRouteDependencies(dependencies);
    const injectedRouter = express.Router();
    const controller = createAdminPaymentController(adminPaymentObservabilityService, paymentReconciliationService, paymentConfigService);

    injectedRouter.get("/payments/methods", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentMethodsController));
    injectedRouter.get("/payments/intents", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentIntentsController));
    injectedRouter.get("/payments/ledger", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentLedgerController));
    injectedRouter.get("/payments/reconciliation", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentReconciliationController));
    injectedRouter.get("/payments/config", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentConfigController));
    injectedRouter.get("/payments/config/proposals", isAuthenticated, requireAdmin, asyncHandler(controller.listPaymentConfigProposalsController));
    injectedRouter.post("/payments/config/proposals", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.createPaymentConfigProposalController));
    injectedRouter.get("/payments/config/proposals/:id", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentConfigProposalController));
    injectedRouter.post("/payments/config/proposals/:id/confirm", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.confirmPaymentConfigProposalController));
    injectedRouter.post("/payments/config/proposals/:id/approve", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.approvePaymentConfigProposalController));
    injectedRouter.post("/payments/config/proposals/:id/activate", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.activatePaymentConfigProposalController));
    injectedRouter.post("/payments/config/proposals/:id/reject", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.rejectPaymentConfigProposalController));
    injectedRouter.post("/payments/config/proposals/:id/cancel", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.cancelPaymentConfigProposalController));
    injectedRouter.post("/payments/intents/:id/retry-verify", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.retryPaymentVerificationController));
    injectedRouter.post("/payments/intents/:id/review", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.reviewPaymentIntentController));

    return injectedRouter;
};
