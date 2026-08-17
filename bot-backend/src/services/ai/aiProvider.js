const { createGeminiProvider } = require("./providers/geminiProvider");
const { buildOperationKey, recordAiUsage } = require("./aiUsageService");

const defaultProvider = createGeminiProvider();

const safeRecordUsage = async (usageRecorder, operation, result) => {
    try {
        await usageRecorder(operation, result);
    } catch (error) {
        console.error("AI usage recording failed", {
            provider: operation.provider,
            model: operation.model,
            operationKey: operation.operationKey,
            errorCode: error.code || "AI_USAGE_RECORD_FAILED"
        });
    }
};

// AiProvider contract: generateReply returns reply text plus normalized usage
// metadata while keeping provider-specific SDK details behind the provider.
const createAiProvider = ({ provider = defaultProvider, usageRecorder = recordAiUsage } = {}) => {
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

        try {
            const result = await provider.generateReply({ comment, prompt });
            await safeRecordUsage(usageRecorder, operationWithKey, result);
            return { ...result, operationKey };
        } catch (error) {
            await safeRecordUsage(usageRecorder, operationWithKey, {
                usage: {},
                latencyMs: null,
                success: false,
                errorCode: error.providerErrorCode || error.code || "GEMINI_PROVIDER_ERROR"
            });
            throw error;
        }
    };

    return { generateReply };
};

module.exports = createAiProvider();
module.exports.createAiProvider = createAiProvider;
