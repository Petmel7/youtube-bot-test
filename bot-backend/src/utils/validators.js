const { badRequest, unprocessable } = require("./errors");

const MAX_PROMPT_LENGTH = 1200;
const MAX_THEME_LENGTH = 120;
const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;
const PAYMENT_PACKAGE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const PAYMENT_METHOD_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const EVM_TX_HASH_RE = /^0x[a-f0-9]{64}$/;
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_TX_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE_RE = /^[A-Za-z0-9+/]{80,100}={0,2}$/;
const YOUTUBE_PAGE_TOKEN_RE = /^[A-Za-z0-9._~-]{1,256}$/;
const YOUTUBE_DEFAULT_PAGE_SIZE = 12;
const YOUTUBE_MAX_PAGE_SIZE = 25;

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

const validatePaymentPackageId = (packageId) => {
    const value = normalizeString(packageId, "packageId", 80);
    if (!PAYMENT_PACKAGE_ID_RE.test(value)) {
        throw unprocessable("INVALID_PAYMENT_PACKAGE", "Invalid payment package");
    }
    return value;
};

const validatePaymentMethodId = (paymentMethodId) => {
    const value = normalizeString(paymentMethodId, "paymentMethodId", 80);
    if (!PAYMENT_METHOD_ID_RE.test(value)) {
        throw unprocessable("INVALID_PAYMENT_METHOD", "Invalid payment method");
    }
    return value;
};

const validatePaymentIntentId = (id) => {
    const value = normalizeString(id, "paymentIntentId", 64);
    if (!/^[a-f0-9]{24}$/i.test(value)) {
        throw unprocessable("INVALID_PAYMENT_INTENT_ID", "Invalid payment intent ID");
    }
    return value;
};

const validatePaymentTxHash = (txHash) => {
    const value = normalizeString(txHash, "txHash", 128);
    if (!EVM_TX_HASH_RE.test(value) && !SOLANA_TX_SIGNATURE_RE.test(value)) {
        throw unprocessable("INVALID_PAYMENT_TX_HASH", "Invalid payment transaction identifier");
    }
    return value;
};

const validatePaymentNamespace = (namespace) => {
    if (namespace === undefined || namespace === null || namespace === "") return "eip155";
    const value = normalizeString(namespace, "namespace", 16);
    if (!["eip155", "solana"].includes(value)) {
        throw unprocessable("INVALID_PAYMENT_NAMESPACE", "Invalid payment namespace");
    }
    return value;
};

const validateEvmAddress = (address, field = "payerAddress") => {
    const value = normalizeString(address, field, 42);
    if (!EVM_ADDRESS_RE.test(value)) {
        throw unprocessable("INVALID_EVM_ADDRESS", "Invalid EVM address");
    }
    return value;
};

const validatePayerAddress = (address, namespace = "eip155") => {
    if (namespace === "solana") {
        const value = normalizeString(address, "payerAddress", 44);
        if (!SOLANA_ADDRESS_RE.test(value)) {
            throw unprocessable("INVALID_SOLANA_ADDRESS", "Invalid Solana address");
        }
        return value;
    }

    return validateEvmAddress(address);
};

const validatePaymentPayerChallengeId = (id) => {
    const value = normalizeString(id, "payerChallengeId", 64);
    if (!/^[a-f0-9]{24}$/i.test(value)) {
        throw unprocessable("INVALID_PAYER_CHALLENGE", "Invalid payer challenge");
    }
    return value;
};

const validatePaymentSignature = (signature) => {
    const value = normalizeString(signature, "signature", 512);
    if (!/^0x[a-fA-F0-9]{130}$/.test(value) && !SOLANA_SIGNATURE_RE.test(value)) {
        throw unprocessable("INVALID_PAYER_SIGNATURE", "Invalid payer signature");
    }
    return value;
};

const validateYoutubeVideosQuery = (query = {}) => {
    const result = {
        maxResults: YOUTUBE_DEFAULT_PAGE_SIZE,
        pageToken: undefined
    };

    if (query.maxResults !== undefined && query.maxResults !== null && query.maxResults !== "") {
        const maxResults = Number(query.maxResults);
        if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > YOUTUBE_MAX_PAGE_SIZE) {
            throw unprocessable("INVALID_MAX_RESULTS", `maxResults must be an integer between 1 and ${YOUTUBE_MAX_PAGE_SIZE}`);
        }
        result.maxResults = maxResults;
    }

    if (query.pageToken !== undefined && query.pageToken !== null && query.pageToken !== "") {
        const pageToken = normalizeString(query.pageToken, "pageToken", 256);
        if (!YOUTUBE_PAGE_TOKEN_RE.test(pageToken)) {
            throw unprocessable("INVALID_PAGE_TOKEN", "Invalid page token");
        }
        result.pageToken = pageToken;
    }

    return result;
};

module.exports = {
    assertObjectBody,
    validateVideoId,
    validatePrompt,
    validateChannelTheme,
    validateGender,
    validateIdempotencyKey,
    validatePaymentIntentId,
    validatePaymentMethodId,
    validatePaymentPackageId,
    validatePaymentNamespace,
    validatePaymentTxHash,
    validateEvmAddress,
    validatePayerAddress,
    validatePaymentPayerChallengeId,
    validatePaymentSignature,
    validateYoutubeVideosQuery,
    MAX_PROMPT_LENGTH
};
