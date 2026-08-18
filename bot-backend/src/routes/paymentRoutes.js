const express = require("express");
const {
    createPaymentController,
    createPaymentIntentController,
    getPaymentIntentController,
    verifyPaymentIntentController
} = require("../controllers/paymentController");
const { isAuthenticated } = require("../middleware/auth");
const requireWriteHeader = require("../middleware/requireWriteHeader");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.post("/intents", isAuthenticated, requireWriteHeader, asyncHandler(createPaymentIntentController));
router.get("/intents/:id", isAuthenticated, asyncHandler(getPaymentIntentController));
router.post("/intents/:id/verify", isAuthenticated, requireWriteHeader, asyncHandler(verifyPaymentIntentController));

module.exports = router;
module.exports.createPaymentRoutes = (paymentLifecycleService) => {
    const injectedRouter = express.Router();
    const controller = createPaymentController(paymentLifecycleService);

    injectedRouter.post("/intents", isAuthenticated, requireWriteHeader, asyncHandler(controller.createPaymentIntentController));
    injectedRouter.get("/intents/:id", isAuthenticated, asyncHandler(controller.getPaymentIntentController));
    injectedRouter.post("/intents/:id/verify", isAuthenticated, requireWriteHeader, asyncHandler(controller.verifyPaymentIntentController));

    return injectedRouter;
};
