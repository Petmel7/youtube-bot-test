const {
    geminiMaxOutputTokens,
    aiReplyCreditCost,
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
    const credits = aiReplyCreditCost;

    return { promptTokens, outputTokens, credits };
};

const calculateActualAiCost = ({ usage = {} }) => {
    const credits = calculateCredits({
        promptTokens: 0,
        outputTokens: 0
    });

    return {
        promptTokens: Number.isInteger(usage.promptTokens) ? usage.promptTokens : null,
        outputTokens: Number.isInteger(usage.outputTokens) ? usage.outputTokens : null,
        totalTokens: Number.isInteger(usage.totalTokens) ? usage.totalTokens : null,
        credits: credits + aiReplyCreditCost
    };
};

module.exports = {
    calculateActualAiCost,
    calculateCredits,
    estimateAiOperationCost,
    estimateInputTokens
};
