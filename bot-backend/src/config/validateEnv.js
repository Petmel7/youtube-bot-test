const {
    paymentConfig,
    geminiModel,
    geminiMaxOutputTokens,
    geminiThinkingBudget,
    geminiTimeoutMs,
    geminiRetryCount,
    botMaxCommentsPerRun,
    botMaxPagesPerRun,
    botReplyMaxLength,
    aiReplyCreditCost,
    aiPromptTokenCreditRate,
    aiOutputTokenCreditRate,
    aiEstimatedInputCharsPerToken
} = require("./config");
const { isValidEvmAddress, normalizeEvmAddress } = require("../utils/evmAddress");
const { isValidSolanaPublicKey } = require("../utils/solana");
const { getAllowedPaymentMethod, getAllowedPaymentMethodByLegacyNetwork } = require("./paymentNetworks");
const { buildPaymentMethods } = require("./paymentMethods");
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
        ...(geminiThinkingBudget === null ? {} : { GEMINI_THINKING_BUDGET: geminiThinkingBudget }),
        GEMINI_TIMEOUT_MS: geminiTimeoutMs,
        GEMINI_RETRY_COUNT: geminiRetryCount,
        BOT_MAX_COMMENTS_PER_RUN: botMaxCommentsPerRun,
        BOT_MAX_PAGES_PER_RUN: botMaxPagesPerRun,
        BOT_REPLY_MAX_LENGTH: botReplyMaxLength,
        AI_REPLY_CREDIT_COST: aiReplyCreditCost,
        AI_PROMPT_TOKEN_CREDIT_RATE: aiPromptTokenCreditRate,
        AI_OUTPUT_TOKEN_CREDIT_RATE: aiOutputTokenCreditRate,
        AI_ESTIMATED_INPUT_CHARS_PER_TOKEN: aiEstimatedInputCharsPerToken
    };

    Object.entries(numericSettings).forEach(([name, value]) => {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`Invalid ${name} configuration`);
        }
    });

    const nonNegativeIntegerSettings = {
        GEMINI_RETRY_COUNT: geminiRetryCount,
        ...(geminiThinkingBudget === null ? {} : { GEMINI_THINKING_BUDGET: geminiThinkingBudget }),
        AI_PROMPT_TOKEN_CREDIT_RATE: aiPromptTokenCreditRate,
        AI_OUTPUT_TOKEN_CREDIT_RATE: aiOutputTokenCreditRate
    };

    Object.entries(nonNegativeIntegerSettings).forEach(([name, value]) => {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`Invalid ${name} configuration`);
        }
    });

    const positiveIntegerSettings = {
        GEMINI_MAX_OUTPUT_TOKENS: geminiMaxOutputTokens,
        GEMINI_TIMEOUT_MS: geminiTimeoutMs,
        BOT_MAX_COMMENTS_PER_RUN: botMaxCommentsPerRun,
        BOT_MAX_PAGES_PER_RUN: botMaxPagesPerRun,
        BOT_REPLY_MAX_LENGTH: botReplyMaxLength,
        AI_REPLY_CREDIT_COST: aiReplyCreditCost,
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

    if (!Number.isInteger(config.confirmations) || config.confirmations < 1) {
        throw new Error("Invalid PAYMENT_CONFIRMATIONS configuration");
    }

    if (!Number.isInteger(config.verifyThrottleWindowMs) || config.verifyThrottleWindowMs < 1000) {
        throw new Error("Invalid PAYMENT_VERIFY_THROTTLE_WINDOW_MS configuration");
    }

    if (!Number.isInteger(config.verifyThrottleMax) || config.verifyThrottleMax < 1) {
        throw new Error("Invalid PAYMENT_VERIFY_THROTTLE_MAX configuration");
    }

    if (!Number.isInteger(config.intentTtlMinutes) || config.intentTtlMinutes <= 0) {
        throw new Error("Invalid PAYMENT_INTENT_TTL_MINUTES configuration");
    }

    if (typeof config.pricingVersion !== "string" || config.pricingVersion.trim() === "") {
        throw new Error("Invalid PAYMENT_PRICING_VERSION configuration");
    }

    parsePaymentPackages(config.packagesJson, { pricingVersion: config.pricingVersion });
    validatePaymentMethodsConfig(config, { nodeEnv });
};

const validateUrl = (value, envName) => {
    try {
        const url = new URL(value);
        if (!["http:", "https:"].includes(url.protocol)) {
            throw new Error("invalid protocol");
        }
    } catch {
        throw new Error(`Invalid ${envName} configuration`);
    }
};

const validatePaymentMethodsConfig = (config, { nodeEnv = process.env.NODE_ENV } = {}) => {
    if (!config.methodsJson) {
        const legacyMethod = getAllowedPaymentMethodByLegacyNetwork(config.network);
        if (!legacyMethod) {
            throw new Error("Invalid PAYMENT_NETWORK configuration");
        }
        if (nodeEnv === "production" && !legacyMethod.production) {
            throw new Error("Invalid PAYMENT_NETWORK configuration");
        }
        if (!Number.isInteger(config.chainId) || config.chainId !== legacyMethod.chainId) {
            throw new Error("Invalid PAYMENT_CHAIN_ID configuration");
        }
        validateUrl(config.rpcUrl, "PAYMENT_RPC_URL");
        if (normalizeEvmAddress(config.tokenAddress) !== legacyMethod.tokenAddress) {
            throw new Error("Invalid PAYMENT_TOKEN_ADDRESS configuration");
        }
        if (config.tokenSymbol !== legacyMethod.tokenSymbol) {
            throw new Error("Invalid PAYMENT_TOKEN_SYMBOL configuration");
        }
        if (config.tokenDecimals !== legacyMethod.tokenDecimals) {
            throw new Error("Invalid PAYMENT_TOKEN_DECIMALS configuration");
        }
        if (!isValidEvmAddress(config.treasuryAddress)) {
            throw new Error("Invalid PAYMENT_TREASURY_ADDRESS configuration");
        }
    }

    const methods = buildPaymentMethods(config);
    const enabledMethods = methods.filter(method => method.enabled);

    if (enabledMethods.length === 0) {
        throw new Error("Invalid PAYMENT_METHODS_JSON configuration");
    }

    const defaultMethodId = config.defaultMethodId || enabledMethods[0].id;
    if (!enabledMethods.some(method => method.id === defaultMethodId)) {
        throw new Error("Invalid PAYMENT_DEFAULT_METHOD_ID configuration");
    }

    enabledMethods.forEach((method) => {
        const allowed = getAllowedPaymentMethod(method.id);
        if (!allowed) {
            throw new Error("Invalid PAYMENT_METHOD_ID configuration");
        }

        if (nodeEnv === "production" && !allowed.production) {
            throw new Error("Invalid PAYMENT_METHOD_ID configuration");
        }

        if (!allowed.production && config.allowTestnetPayments !== true) {
            throw new Error("Invalid ALLOW_TESTNET_PAYMENTS configuration");
        }

        if (!allowed.production && !["development", "test", "local"].includes(nodeEnv)) {
            throw new Error("Invalid NODE_ENV configuration for testnet payments");
        }

        if ((method.namespace || "eip155") !== (allowed.namespace || "eip155")) {
            throw new Error("Invalid PAYMENT_METHOD_NAMESPACE configuration");
        }

        validateUrl(method.rpcUrl, "PAYMENT_METHOD_RPC_URL");

        if (method.networkId !== allowed.networkId || method.caipNetworkId !== allowed.caipNetworkId) {
            throw new Error("Invalid PAYMENT_METHOD_NETWORK_ID configuration");
        }

        if (method.assetType !== allowed.assetType) {
            throw new Error("Invalid PAYMENT_METHOD_ASSET_TYPE configuration");
        }

        if ((allowed.namespace || "eip155") === "solana") {
            if (method.cluster !== allowed.cluster) {
                throw new Error("Invalid PAYMENT_METHOD_NETWORK_ID configuration");
            }

            if (!isValidSolanaPublicKey(method.mintAddress) || method.mintAddress !== allowed.mintAddress) {
                throw new Error("Invalid PAYMENT_METHOD_MINT_ADDRESS configuration");
            }

            if (!isValidSolanaPublicKey(method.treasuryAddress)) {
                throw new Error("Invalid PAYMENT_METHOD_TREASURY_ADDRESS configuration");
            }
        } else {
            if (!Number.isInteger(method.chainId) || method.chainId <= 0 || method.chainId !== allowed.chainId) {
                throw new Error("Invalid PAYMENT_METHOD_CHAIN_ID configuration");
            }

            const configuredTokenAddress = normalizeEvmAddress(method.tokenAddress);
            if (!isValidEvmAddress(method.tokenAddress) || configuredTokenAddress !== allowed.tokenAddress) {
                throw new Error("Invalid PAYMENT_METHOD_TOKEN_ADDRESS configuration");
            }

            if (!isValidEvmAddress(method.treasuryAddress)) {
                throw new Error("Invalid PAYMENT_METHOD_TREASURY_ADDRESS configuration");
            }
        }

        if (method.tokenSymbol !== allowed.tokenSymbol) {
            throw new Error("Invalid PAYMENT_METHOD_TOKEN_SYMBOL configuration");
        }

        if (!Number.isInteger(method.tokenDecimals) || method.tokenDecimals !== allowed.tokenDecimals) {
            throw new Error("Invalid PAYMENT_METHOD_TOKEN_DECIMALS configuration");
        }

        if ((method.assetProvenance || null) !== (allowed.assetProvenance || null)) {
            throw new Error("Invalid PAYMENT_METHOD_ASSET_PROVENANCE configuration");
        }

        if (method.testnet !== allowed.testnet || method.smoke !== allowed.smoke) {
            throw new Error("Invalid PAYMENT_METHOD_ENVIRONMENT configuration");
        }

    });
};

module.exports = validateEnv;
module.exports.validatePaymentConfig = validatePaymentConfig;
module.exports.validatePaymentMethodsConfig = validatePaymentMethodsConfig;
