const express = require("express");
const {
    createPaymentController,
    createPayerChallengeController,
    createPaymentIntentController,
    getPaymentPackagesController,
    getWalletController,
    getPaymentIntentController,
    verifyPaymentIntentController
} = require("../controllers/paymentController");
const { isAuthenticated } = require("../middleware/auth");
const requireWriteHeader = require("../middleware/requireWriteHeader");
const paymentVerifyThrottle = require("../middleware/paymentVerifyThrottle");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/packages", isAuthenticated, asyncHandler(getPaymentPackagesController));
router.get("/wallet", isAuthenticated, asyncHandler(getWalletController));
router.post("/payer-challenges", isAuthenticated, requireWriteHeader, asyncHandler(createPayerChallengeController));
router.post("/intents", isAuthenticated, requireWriteHeader, asyncHandler(createPaymentIntentController));
router.get("/intents/:id", isAuthenticated, asyncHandler(getPaymentIntentController));
router.post("/intents/:id/verify", isAuthenticated, requireWriteHeader, paymentVerifyThrottle, asyncHandler(verifyPaymentIntentController));

module.exports = router;
module.exports.createPaymentRoutes = (paymentLifecycleService, dependencies) => {
    const injectedRouter = express.Router();
    const controller = createPaymentController(paymentLifecycleService, dependencies);
    const verifyThrottleMiddleware = dependencies?.verifyThrottleMiddleware || paymentVerifyThrottle;

    injectedRouter.get("/packages", isAuthenticated, asyncHandler(controller.getPaymentPackagesController));
    injectedRouter.get("/wallet", isAuthenticated, asyncHandler(controller.getWalletController));
    injectedRouter.post("/payer-challenges", isAuthenticated, requireWriteHeader, asyncHandler(controller.createPayerChallengeController));
    injectedRouter.post("/intents", isAuthenticated, requireWriteHeader, asyncHandler(controller.createPaymentIntentController));
    injectedRouter.get("/intents/:id", isAuthenticated, asyncHandler(controller.getPaymentIntentController));
    injectedRouter.post("/intents/:id/verify", isAuthenticated, requireWriteHeader, verifyThrottleMiddleware, asyncHandler(controller.verifyPaymentIntentController));

    return injectedRouter;
};
