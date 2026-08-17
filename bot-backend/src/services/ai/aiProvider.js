const { createGeminiProvider } = require("./providers/geminiProvider");
const {
    buildOperationKey,
    recordAiUsage,
    updateAiUsageBillingStatus
} = require("./aiUsageService");
const { calculateActualAiCost, estimateAiOperationCost } = require("../billing/costEstimator");
const walletService = require("../billing/walletService");
const { accountingError, conflict } = require("../../utils/errors");

const defaultProvider = createGeminiProvider();

// AiProvider contract: generateReply returns reply text plus normalized usage
// metadata while keeping provider-specific SDK details behind the provider.
const createAiProvider = ({
    provider = defaultProvider,
    usageRecorder = recordAiUsage,
    usageStatusUpdater = updateAiUsageBillingStatus,
    wallet = walletService,
    estimateCost = estimateAiOperationCost,
    calculateActualCost = calculateActualAiCost
} = {}) => {
    const generateReply = async ({ userId, runId, videoId, commentId, comment, prompt }) => {
        const operation = {
            userId,
            runId,
            videoId,
            commentId,
            provider: provider.provider,
            model: provider.model
        };
        const operationKey = buildOperationKey(operation);
        const operationWithKey = { ...operation, operationKey };
        const referenceType = "aiusage";
        const referenceId = operationKey;
        const reservationKey = `${operationKey}:RESERVATION`;
        const debitKey = `${operationKey}:DEBIT`;
        const releaseKey = `${operationKey}:RELEASE`;
        const estimate = estimateCost({ comment, prompt, provider: provider.provider, model: provider.model });
        const billingMetadata = {
            operationKey,
            provider: provider.provider,
            model: provider.model,
            runId: String(runId),
            videoId,
            commentId
        };

        const reservation = await wallet.reserveCredits({
            userId,
            amount: estimate.credits,
            idempotencyKey: reservationKey,
            referenceType,
            referenceId,
            metadata: billingMetadata
        });
        if (!reservation.created) {
            throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation was already processed");
        }

        try {
            const result = await provider.generateReply({ comment, prompt });
            let actual;

            try {
                actual = calculateActualCost({ usage: result.usage, provider: result.provider, model: result.model });
            } catch (error) {
                try {
                    await usageRecorder(operationWithKey, {
                        ...result,
                        estimatedCredits: estimate.credits,
                        reservedCredits: estimate.credits,
                        billingStatus: "ACCOUNTING_RECOVERY_REQUIRED",
                        errorCode: error.code || "ACCOUNTING_ERROR"
                    });
                } finally {
                    await wallet.releaseReservation({
                        userId,
                        amount: estimate.credits,
                        idempotencyKey: releaseKey,
                        referenceType,
                        referenceId,
                        metadata: { ...billingMetadata, reason: "missing-usage" }
                    });
                }
                throw error;
            }

            try {
                await usageRecorder(operationWithKey, {
                    ...result,
                    estimatedCredits: estimate.credits,
                    reservedCredits: estimate.credits,
                    actualCredits: actual.credits,
                    billingStatus: "USAGE_RECORDED"
                });
            } catch (error) {
                await wallet.releaseReservation({
                    userId,
                    amount: estimate.credits,
                    idempotencyKey: releaseKey,
                    referenceType,
                    referenceId,
                    metadata: { ...billingMetadata, reason: "usage-record-failed" }
                });
                throw accountingError("ACCOUNTING_ERROR", "AI usage recording failed");
            }

            try {
                await wallet.finalizeCharge({
                    userId,
                    reservedAmount: estimate.credits,
                    actualAmount: actual.credits,
                    debitKey,
                    releaseKey,
                    referenceType,
                    referenceId,
                    metadata: billingMetadata
                });
                await usageStatusUpdater(operationKey, {
                    billingStatus: "CHARGE_FINALIZED",
                    actualCredits: actual.credits
                });
            } catch (error) {
                await usageStatusUpdater(operationKey, {
                    billingStatus: "ACCOUNTING_RECOVERY_REQUIRED",
                    errorCode: error.code || "ACCOUNTING_ERROR",
                    actualCredits: actual.credits
                });
                throw accountingError(error.code || "ACCOUNTING_ERROR", "AI billing finalization failed");
            }

            return { ...result, operationKey };
        } catch (error) {
            if (error.code?.startsWith("ACCOUNTING_")) {
                throw error;
            }

            try {
                await usageRecorder(operationWithKey, {
                    usage: {},
                    latencyMs: null,
                    success: false,
                    errorCode: error.providerErrorCode || error.code || "GEMINI_PROVIDER_ERROR",
                    estimatedCredits: estimate.credits,
                    reservedCredits: estimate.credits,
                    actualCredits: 0,
                    billingStatus: "PROVIDER_FAILED"
                });
            } finally {
                await wallet.releaseReservation({
                    userId,
                    amount: estimate.credits,
                    idempotencyKey: releaseKey,
                    referenceType,
                    referenceId,
                    metadata: { ...billingMetadata, reason: "provider-failed" }
                });
            }
            throw error;
        }
    };

    return { generateReply };
};

module.exports = createAiProvider();
module.exports.createAiProvider = createAiProvider;
