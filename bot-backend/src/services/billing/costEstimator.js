const {
    geminiMaxOutputTokens,
    aiPromptTokenCreditRate,
    aiOutputTokenCreditRate,
    aiEstimatedInputCharsPerToken
} = require("../../config/config");
const { accountingError } = require("../../utils/errors");

const assertNonNegativeInteger = (value, field) => {
    if (!Number.isInteger(value) || value < 0) {
        throw accountingError("ACCOUNTING_INVALID_AMOUNT", `${field} must be a non-negative integer`);
    }
};

const estimateInputTokens = ({ comment = "", prompt = "" }) => {
    const chars = String(comment).length + String(prompt).length;
    return Math.max(1, Math.ceil(chars / aiEstimatedInputCharsPerToken));
};

const calculateCredits = ({ promptTokens, outputTokens }) => {
    assertNonNegativeInteger(promptTokens, "promptTokens");
    assertNonNegativeInteger(outputTokens, "outputTokens");

    const credits = (promptTokens * aiPromptTokenCreditRate) + (outputTokens * aiOutputTokenCreditRate);
    assertNonNegativeInteger(credits, "credits");
    return credits;
};

const estimateAiOperationCost = ({ comment, prompt }) => {
    const promptTokens = estimateInputTokens({ comment, prompt });
    const outputTokens = geminiMaxOutputTokens;
    const credits = calculateCredits({ promptTokens, outputTokens });

    return { promptTokens, outputTokens, credits };
};

const calculateActualAiCost = ({ usage = {} }) => {
    if (!Number.isInteger(usage.promptTokens) || !Number.isInteger(usage.outputTokens)) {
        throw accountingError("ACCOUNTING_USAGE_MISSING", "AI usage metadata is required for billing");
    }

    const credits = calculateCredits({
        promptTokens: usage.promptTokens,
        outputTokens: usage.outputTokens
    });

    return {
        promptTokens: usage.promptTokens,
        outputTokens: usage.outputTokens,
        totalTokens: Number.isInteger(usage.totalTokens) ? usage.totalTokens : null,
        credits
    };
};

module.exports = {
    calculateActualAiCost,
    calculateCredits,
    estimateAiOperationCost,
    estimateInputTokens
};
