require("dotenv").config();
const { normalizeEvmAddress } = require("../utils/evmAddress");
const {
    BASE_MAINNET_CHAIN_ID,
    baseMainnetUsdcAddress,
    baseSepoliaUsdcAddress,
    supportedPaymentNetworks
} = require("./paymentNetworks");

const parseBooleanEnv = (value, defaultValue) => {
    if (value === undefined) return defaultValue;
    return value === "true";
};

module.exports = {
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    youtubeApiBase: process.env.YOUTUBE_API_BASE,
    youtubeScopeReadonly: process.env.YOUTUBE_SCOPE_READONLY,
    youtubeScopeFull: process.env.YOUTUBE_SCOPE_FULL,
    sessionSecret: process.env.SESSION_SECRET,
    oauthTokenEncryptionKey: process.env.OAUTH_TOKEN_ENCRYPTION_KEY,
    mongoUri: process.env.MONGO_URI,
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    geminiMaxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 384),
    geminiThinkingBudget: process.env.GEMINI_THINKING_BUDGET === undefined
        ? 0
        : Number(process.env.GEMINI_THINKING_BUDGET),
    geminiThinkingLevel: process.env.GEMINI_THINKING_LEVEL || "minimal",
    geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 15000),
    geminiRetryCount: Number(process.env.GEMINI_RETRY_COUNT || 1),
    geminiRequestSpacingMs: Number(process.env.GEMINI_REQUEST_SPACING_MS || 1500),
    commentPublishLockTtlMs: Number(process.env.COMMENT_PUBLISH_LOCK_TTL_MS || 300000),
    botRunStaleLockMs: Number(process.env.BOT_RUN_STALE_LOCK_MS || 300000),
    botRunRecoveryOnStartup: parseBooleanEnv(process.env.BOT_RUN_RECOVERY_ON_STARTUP, true),
    botRunRecoveryBatchSize: Number(process.env.BOT_RUN_RECOVERY_BATCH_SIZE || 20),
    botRunRecoveryIntervalMs: Number(process.env.BOT_RUN_RECOVERY_INTERVAL_MS || 60000),
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
    rateLimitGlobalMax: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 300),
    rateLimitAuthMax: Number(process.env.RATE_LIMIT_AUTH_MAX || 30),
    rateLimitBotMax: Number(process.env.RATE_LIMIT_BOT_MAX || 20),
    rateLimitYoutubeMax: Number(process.env.RATE_LIMIT_YOUTUBE_MAX || 120),
    rateLimitAdminMax: Number(process.env.RATE_LIMIT_ADMIN_MAX || 60),
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
