const { createGeminiProvider } = require("./providers/geminiProvider");
const {
    buildOperationKey,
    getAiUsageByOperationKey,
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
    usageReader = getAiUsageByOperationKey,
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

        const finalizeRecordedUsage = async (usageRecord) => {
            const actual = calculateActualCost({
                usage: {
                    promptTokens: usageRecord.promptTokens,
                    outputTokens: usageRecord.outputTokens,
                    thoughtsTokenCount: usageRecord.thoughtsTokenCount,
                    totalTokens: usageRecord.totalTokens
                },
                provider: usageRecord.provider,
                model: usageRecord.model
            });

            await wallet.finalizeCharge({
                userId,
                reservationKey,
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
                actualCredits: actual.credits,
                reservationKey,
                debitKey,
                releaseKey
            });
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
            const existingUsage = await usageReader(operationKey);

            if (reservation.settlement?.type === "DEBIT") {
                await usageStatusUpdater(operationKey, {
                    billingStatus: "CHARGE_FINALIZED",
                    reservationKey,
                    debitKey,
                    releaseKey
                });
                throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation was already processed");
            }

            if (reservation.settlement?.type === "RELEASE") {
                await usageStatusUpdater(operationKey, {
                    billingStatus: "RESERVATION_RELEASED",
                    reservationKey,
                    releaseKey
                });
                throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation reservation was already released");
            }

            if (existingUsage?.billingStatus === "USAGE_RECORDED" && existingUsage.success) {
                await finalizeRecordedUsage(existingUsage);
                throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation billing was recovered from recorded usage");
            }

            if (existingUsage?.billingStatus === "PROVIDER_FAILED") {
                await wallet.releaseReservation({
                    userId,
                    reservationKey,
                    amount: estimate.credits,
                    idempotencyKey: releaseKey,
                    referenceType,
                    referenceId,
                    metadata: { ...billingMetadata, reason: "provider-failed-recovery" }
                });
                await usageStatusUpdater(operationKey, {
                    billingStatus: "RESERVATION_RELEASED",
                    actualCredits: 0,
                    reservationKey,
                    releaseKey
                });
                throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation provider failure was recovered");
            }
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
                        reservationKey,
                        releaseKey,
                        billingStatus: "ACCOUNTING_RECOVERY_REQUIRED",
                        errorCode: error.code || "ACCOUNTING_ERROR"
                    });
                } finally {
                    await wallet.releaseReservation({
                        userId,
                        reservationKey,
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
                    finishReason: result.finishReason || null,
                    attemptCount: result.attemptCount || null,
                    retryExhausted: result.retryExhausted,
                    reservationKey,
                    debitKey,
                    releaseKey,
                    billingStatus: "USAGE_RECORDED"
                });
            } catch (error) {
                await wallet.releaseReservation({
                    userId,
                    reservationKey,
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
                    reservationKey,
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
                    actualCredits: actual.credits,
                    reservationKey,
                    debitKey,
                    releaseKey
                });
            } catch (error) {
                await usageStatusUpdater(operationKey, {
                    billingStatus: "ACCOUNTING_RECOVERY_REQUIRED",
                    errorCode: error.code || "ACCOUNTING_ERROR",
                    actualCredits: actual.credits,
                    reservationKey,
                    debitKey,
                    releaseKey
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
                    usage: error.usage || {},
                    latencyMs: error.latencyMs ?? null,
                    success: false,
                    errorCode: error.providerErrorCode || error.code || "GEMINI_PROVIDER_ERROR",
                    providerErrorCode: error.providerErrorCode || null,
                    providerStatus: error.providerStatus ?? null,
                    providerErrorCategory: error.providerErrorCategory || null,
                    finishReason: error.finishReason || null,
                    attemptCount: error.attemptCount || null,
                    retryExhausted: error.retryExhausted,
                    attempts: error.attempts || [],
                    estimatedCredits: estimate.credits,
                    reservedCredits: estimate.credits,
                    actualCredits: 0,
                    reservationKey,
                    releaseKey,
                    billingStatus: "PROVIDER_FAILED"
                });
            } finally {
                await wallet.releaseReservation({
                    userId,
                    reservationKey,
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
