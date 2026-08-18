const {
    paymentConfig,
    geminiModel,
    geminiMaxOutputTokens,
    geminiTimeoutMs,
    geminiRetryCount,
    botMaxCommentsPerRun,
    botMaxPagesPerRun,
    botReplyMaxLength,
    aiPromptTokenCreditRate,
    aiOutputTokenCreditRate,
    aiEstimatedInputCharsPerToken
} = require("./config");
const { isValidEvmAddress, normalizeEvmAddress } = require("../utils/evmAddress");
const { BASE_MAINNET_CHAIN_ID, getSupportedPaymentNetwork } = require("./paymentNetworks");
const { parsePaymentPackages } = require("../services/billing/paymentPricingService");

const requiredEnv = [
    "MONGO_URI",
    "SESSION_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI",
    "YOUTUBE_API_BASE",
    "GEMINI_API_KEY"
];

const validateEnv = () => {
    const missing = requiredEnv.filter((name) => !process.env[name]);

    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
    }

    if (!process.env.CLIENT_DEV_URL && process.env.NODE_ENV !== "production") {
        throw new Error("Missing required environment variable: CLIENT_DEV_URL");
    }

    if (process.env.NODE_ENV === "production" && !process.env.CLIENT_PROD_URL) {
        throw new Error("Missing required environment variable: CLIENT_PROD_URL");
    }

    if (!geminiModel || !/^gemini-[A-Za-z0-9._-]+$/.test(geminiModel)) {
        throw new Error("Invalid GEMINI_MODEL configuration");
    }

    const numericSettings = {
        GEMINI_MAX_OUTPUT_TOKENS: geminiMaxOutputTokens,
        GEMINI_TIMEOUT_MS: geminiTimeoutMs,
        GEMINI_RETRY_COUNT: geminiRetryCount,
        BOT_MAX_COMMENTS_PER_RUN: botMaxCommentsPerRun,
        BOT_MAX_PAGES_PER_RUN: botMaxPagesPerRun,
        BOT_REPLY_MAX_LENGTH: botReplyMaxLength,
        AI_PROMPT_TOKEN_CREDIT_RATE: aiPromptTokenCreditRate,
        AI_OUTPUT_TOKEN_CREDIT_RATE: aiOutputTokenCreditRate,
        AI_ESTIMATED_INPUT_CHARS_PER_TOKEN: aiEstimatedInputCharsPerToken
    };

    Object.entries(numericSettings).forEach(([name, value]) => {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`Invalid ${name} configuration`);
        }
    });

    const positiveIntegerSettings = {
        AI_PROMPT_TOKEN_CREDIT_RATE: aiPromptTokenCreditRate,
        AI_OUTPUT_TOKEN_CREDIT_RATE: aiOutputTokenCreditRate,
        AI_ESTIMATED_INPUT_CHARS_PER_TOKEN: aiEstimatedInputCharsPerToken
    };

    Object.entries(positiveIntegerSettings).forEach(([name, value]) => {
        if (!Number.isInteger(value) || value <= 0) {
            throw new Error(`Invalid ${name} configuration`);
        }
    });

    validatePaymentConfig(paymentConfig);
};

const normalizeValidationOptions = (options) => (typeof options === "string" ? {} : (options || {}));

const validatePaymentConfig = (config, options = {}) => {
    const {
        nodeEnv = process.env.NODE_ENV
    } = normalizeValidationOptions(options);
    const supportedNetwork = getSupportedPaymentNetwork(config.chainId);

    if (!Number.isInteger(config.chainId) || config.chainId <= 0 || !supportedNetwork) {
        throw new Error("Invalid PAYMENT_CHAIN_ID configuration");
    }

    if (nodeEnv === "production" && config.chainId !== BASE_MAINNET_CHAIN_ID) {
        throw new Error("Invalid PAYMENT_CHAIN_ID configuration");
    }

    try {
        const url = new URL(config.rpcUrl);
        if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("invalid protocol");
        }
    } catch {
        throw new Error("Invalid PAYMENT_RPC_URL configuration");
    }

    const configuredTokenAddress = normalizeEvmAddress(config.tokenAddress);
    if (!isValidEvmAddress(config.tokenAddress) || configuredTokenAddress !== supportedNetwork.tokenAddress) {
        throw new Error("Invalid PAYMENT_TOKEN_ADDRESS configuration");
    }

    if (config.tokenSymbol !== "USDC") {
        throw new Error("Invalid PAYMENT_TOKEN_SYMBOL configuration");
    }

    if (!Number.isInteger(config.tokenDecimals) || config.tokenDecimals !== 6) {
        throw new Error("Invalid PAYMENT_TOKEN_DECIMALS configuration");
    }

    if (!isValidEvmAddress(config.treasuryAddress)) {
        throw new Error("Invalid PAYMENT_TREASURY_ADDRESS configuration");
    }

    if (!Number.isInteger(config.confirmations) || config.confirmations < 1) {
        throw new Error("Invalid PAYMENT_CONFIRMATIONS configuration");
    }

    if (!Number.isInteger(config.intentTtlMinutes) || config.intentTtlMinutes <= 0) {
        throw new Error("Invalid PAYMENT_INTENT_TTL_MINUTES configuration");
    }

    if (typeof config.pricingVersion !== "string" || config.pricingVersion.trim() === "") {
        throw new Error("Invalid PAYMENT_PRICING_VERSION configuration");
    }

    parsePaymentPackages(config.packagesJson, { pricingVersion: config.pricingVersion });
};

module.exports = validateEnv;
module.exports.validatePaymentConfig = validatePaymentConfig;
