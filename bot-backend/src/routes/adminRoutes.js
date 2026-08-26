const express = require("express");
const {
    createAdminPaymentController,
    getPaymentIntentsController,
    getPaymentLedgerController,
    getPaymentMethodsController
} = require("../controllers/adminPaymentController");
const { isAuthenticated } = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/payments/methods", isAuthenticated, requireAdmin, asyncHandler(getPaymentMethodsController));
router.get("/payments/intents", isAuthenticated, requireAdmin, asyncHandler(getPaymentIntentsController));
router.get("/payments/ledger", isAuthenticated, requireAdmin, asyncHandler(getPaymentLedgerController));

module.exports = router;
module.exports.createAdminRoutes = (adminPaymentObservabilityService) => {
    const injectedRouter = express.Router();
    const controller = createAdminPaymentController(adminPaymentObservabilityService);

    injectedRouter.get("/payments/methods", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentMethodsController));
    injectedRouter.get("/payments/intents", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentIntentsController));
    injectedRouter.get("/payments/ledger", isAuthenticated, requireAdmin, asyncHandler(controller.getPaymentLedgerController));

    return injectedRouter;
};
