const { badRequest, unprocessable } = require("./errors");

const MAX_PROMPT_LENGTH = 1200;
const MAX_THEME_LENGTH = 120;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;

const assertObjectBody = (body) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw badRequest("INVALID_BODY", "Request body must be a JSON object");
    }
};

const normalizeString = (value, field, maxLength) => {
    if (typeof value !== "string") {
        throw badRequest("INVALID_FIELD", `${field} must be a string`);
    }

    const trimmed = value.trim();
    if (!trimmed) {
        throw unprocessable("MISSING_FIELD", `${field} is required`);
    }

    if (trimmed.length > maxLength) {
        throw unprocessable("FIELD_TOO_LONG", `${field} is too long`);
    }

    return trimmed;
};

const validateVideoId = (videoId) => {
    const value = normalizeString(videoId, "videoId", 32);
    if (!YOUTUBE_VIDEO_ID_RE.test(value)) {
        throw unprocessable("INVALID_VIDEO_ID", "Invalid YouTube video ID");
    }
    return value;
};

const validatePrompt = (prompt) => {
    if (prompt === undefined || prompt === null || prompt === "") {
        return "";
    }
    return normalizeString(prompt, "prompt", MAX_PROMPT_LENGTH);
};

const validateChannelTheme = (channelTheme) => normalizeString(channelTheme, "channelTheme", MAX_THEME_LENGTH);

const validateGender = (gender) => {
    const value = normalizeString(gender, "gender", 16);
    if (!["male", "female"].includes(value)) {
        throw unprocessable("INVALID_GENDER", "gender must be male or female");
    }
    return value;
};

const validateIdempotencyKey = (key) => {
    const value = normalizeString(key, "idempotencyKey", 80);
    if (!IDEMPOTENCY_KEY_RE.test(value)) {
        throw unprocessable("INVALID_IDEMPOTENCY_KEY", "Invalid idempotency key");
    }
    return value;
};

module.exports = {
    assertObjectBody,
    validateVideoId,
    validatePrompt,
    validateChannelTheme,
    validateGender,
    validateIdempotencyKey,
    MAX_PROMPT_LENGTH
};
