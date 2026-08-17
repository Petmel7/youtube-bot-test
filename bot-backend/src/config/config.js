require("dotenv").config();

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
    geminiMaxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 180),
    geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 15000),
    geminiRetryCount: Number(process.env.GEMINI_RETRY_COUNT || 2),
    botMaxCommentsPerRun: Number(process.env.BOT_MAX_COMMENTS_PER_RUN || 10),
    botMaxPagesPerRun: Number(process.env.BOT_MAX_PAGES_PER_RUN || 2),
    botReplyMaxLength: Number(process.env.BOT_REPLY_MAX_LENGTH || 500),
    aiCreditUnit: process.env.AI_CREDIT_UNIT || "AI_CREDIT",
    aiPromptTokenCreditRate: Number(process.env.AI_PROMPT_TOKEN_CREDIT_RATE || 1),
    aiOutputTokenCreditRate: Number(process.env.AI_OUTPUT_TOKEN_CREDIT_RATE || 4),
    aiEstimatedInputCharsPerToken: Number(process.env.AI_ESTIMATED_INPUT_CHARS_PER_TOKEN || 4),
};
