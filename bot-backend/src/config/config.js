require("dotenv").config();
const { normalizeEvmAddress } = require("../utils/evmAddress");
const {
    BASE_MAINNET_CHAIN_ID,
    baseMainnetUsdcAddress,
    baseSepoliaUsdcAddress,
    supportedPaymentNetworks
} = require("./paymentNetworks");

module.exports = {
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    youtubeApiBase: process.env.YOUTUBE_API_BASE,
    youtubeScopeReadonly: process.env.YOUTUBE_SCOPE_READONLY,
    youtubeScopeFull: process.env.YOUTUBE_SCOPE_FULL,
    sessionSecret: process.env.SESSION_SECRET,
    mongoUri: process.env.MONGO_URI,
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    geminiMaxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 1024),
    geminiThinkingBudget: process.env.GEMINI_THINKING_BUDGET === undefined
        ? null
        : Number(process.env.GEMINI_THINKING_BUDGET),
    geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 30000),
    geminiRetryCount: Number(process.env.GEMINI_RETRY_COUNT || 2),
    botMaxCommentsPerRun: Number(process.env.BOT_MAX_COMMENTS_PER_RUN || 10),
    botMaxPagesPerRun: Number(process.env.BOT_MAX_PAGES_PER_RUN || 2),
    botReplyMaxLength: Number(process.env.BOT_REPLY_MAX_LENGTH || 500),
    aiCreditUnit: process.env.AI_CREDIT_UNIT || "AI_CREDIT",
    aiReplyCreditCost: Number(process.env.AI_REPLY_CREDIT_COST || 1),
    aiPromptTokenCreditRate: Number(process.env.AI_PROMPT_TOKEN_CREDIT_RATE || 0),
    aiOutputTokenCreditRate: Number(process.env.AI_OUTPUT_TOKEN_CREDIT_RATE || 0),
    aiEstimatedInputCharsPerToken: Number(process.env.AI_ESTIMATED_INPUT_CHARS_PER_TOKEN || 4),
    paymentConfig: {
        network: process.env.PAYMENT_NETWORK,
        allowTestnetPayments: process.env.ALLOW_TESTNET_PAYMENTS === "true",
        defaultMethodId: process.env.PAYMENT_DEFAULT_METHOD_ID,
        methodsJson: process.env.PAYMENT_METHODS_JSON,
        chainId: Number(process.env.PAYMENT_CHAIN_ID || BASE_MAINNET_CHAIN_ID),
        rpcUrl: process.env.PAYMENT_RPC_URL,
        tokenAddress: normalizeEvmAddress(process.env.PAYMENT_TOKEN_ADDRESS || baseMainnetUsdcAddress),
        tokenSymbol: process.env.PAYMENT_TOKEN_SYMBOL || "USDC",
        tokenDecimals: Number(process.env.PAYMENT_TOKEN_DECIMALS || 6),
        treasuryAddress: normalizeEvmAddress(process.env.PAYMENT_TREASURY_ADDRESS),
        confirmations: Number(process.env.PAYMENT_CONFIRMATIONS || 60),
        verifyThrottleWindowMs: Number(process.env.PAYMENT_VERIFY_THROTTLE_WINDOW_MS || 60000),
        verifyThrottleMax: Number(process.env.PAYMENT_VERIFY_THROTTLE_MAX || 10),
        intentTtlMinutes: Number(process.env.PAYMENT_INTENT_TTL_MINUTES),
        pricingVersion: process.env.PAYMENT_PRICING_VERSION,
        packagesJson: process.env.PAYMENT_PACKAGES_JSON
    },
    paymentBaseNativeUsdcAddress: baseMainnetUsdcAddress,
    paymentBaseSepoliaUsdcAddress: baseSepoliaUsdcAddress,
    supportedPaymentNetworks
};
