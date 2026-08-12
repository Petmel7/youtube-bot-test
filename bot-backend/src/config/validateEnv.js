const {
    geminiModel,
    geminiMaxOutputTokens,
    geminiTimeoutMs,
    geminiRetryCount,
    botMaxCommentsPerRun,
    botMaxPagesPerRun,
    botReplyMaxLength
} = require("./config");

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
        BOT_REPLY_MAX_LENGTH: botReplyMaxLength
    };

    Object.entries(numericSettings).forEach(([name, value]) => {
        if (!Number.isFinite(value) || value < 0) {
            throw new Error(`Invalid ${name} configuration`);
        }
    });
};

module.exports = validateEnv;
