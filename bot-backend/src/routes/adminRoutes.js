const express = require("express");
const {
    createAdminPaymentController,
    getPaymentIntentsController,
    getPaymentLedgerController,
    getPaymentMethodsController,
    getPaymentReconciliationController,
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
        paymentReconciliationService
    } = normalizeAdminRouteDependencies(dependencies);
    const injectedRouter = express.Router();
    const controller = createAdminPaymentController(adminPaymentObservabilityService, paymentReconciliationService);

    injectedRouter.get("/payments/methods", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentMethodsController));
    injectedRouter.get("/payments/intents", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentIntentsController));
    injectedRouter.get("/payments/ledger", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentLedgerController));
    injectedRouter.get("/payments/reconciliation", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentReconciliationController));
    injectedRouter.post("/payments/intents/:id/retry-verify", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.retryPaymentVerificationController));
    injectedRouter.post("/payments/intents/:id/review", isAuthenticated, requireAdmin, requireWriteHeader, asyncHandler(controller.reviewPaymentIntentController));

    return injectedRouter;
};
