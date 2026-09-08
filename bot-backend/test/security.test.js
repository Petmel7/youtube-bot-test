const test = require("node:test");
const assert = require("node:assert/strict");
const { google } = require("googleapis");

const { toSafeUser, toPromptDto } = require("../src/utils/dto");
const User = require("../src/models/User");
const { getValidAccessToken } = require("../src/services/authService");
const { encryptToken, decryptToken, isEncryptedToken } = require("../src/services/security/tokenCrypto");
const passportConfig = require("../src/config/passport");
const validateEnv = require("../src/config/validateEnv");
const { validateOauthTokenEncryptionKey } = validateEnv;
const {
    validateVideoId,
    validateGender,
    validatePrompt,
    validateIdempotencyKey
} = require("../src/utils/validators");
const { validateGeneratedReply } = require("../src/services/geminiService");

const tokenKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

const withTokenKey = async (fn) => {
    const previous = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    process.env.OAUTH_TOKEN_ENCRYPTION_KEY = tokenKey;
    try {
        await fn();
    } finally {
        if (previous === undefined) {
            delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
        } else {
            process.env.OAUTH_TOKEN_ENCRYPTION_KEY = previous;
        }
    }
};

test("safe user DTO excludes OAuth tokens", () => {
    const dto = toSafeUser({
        _id: "64b000000000000000000000",
        name: "Test User",
        email: "test@example.com",
        role: "admin",
        tokens: {
            access_token: "secret-access",
            refresh_token: "secret-refresh"
        }
    });

    assert.equal(dto.id, "64b000000000000000000000");
    assert.equal(dto.youtubeConnected, true);
    assert.equal(dto.tokens, undefined);
    assert.equal(dto.access_token, undefined);
    assert.equal(dto.refresh_token, undefined);
});

test("User OAuth token fields are excluded from default queries", () => {
    assert.equal(User.schema.path("tokens.access_token").options.select, false);
    assert.equal(User.schema.path("tokens.refresh_token").options.select, false);
    assert.equal(User.schema.path("tokens.expiry_date").options.select, false);
});

test("passport deserializeUser does not explicitly load OAuth token fields", async (t) => {
    let findByIdCalled = false;
    t.mock.method(User, "findById", async (id) => {
        findByIdCalled = true;
        assert.equal(id, "64b000000000000000000010");
        return {
            _id: id,
            name: "Test User",
            email: "test@example.com"
        };
    });

    const deserializer = passportConfig._deserializers[0];
    const user = await new Promise((resolve, reject) => {
        deserializer("64b000000000000000000010", (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });

    assert.equal(findByIdCalled, true);
    assert.equal(user.tokens, undefined);
});

test("OAuth token crypto encrypts configured tokens and reads legacy plaintext", async () => {
    await withTokenKey(async () => {
        const encrypted = encryptToken("oauth-secret-value");

        assert.equal(isEncryptedToken(encrypted), true);
        assert.notEqual(encrypted, "oauth-secret-value");
        assert.equal(decryptToken(encrypted), "oauth-secret-value");
        assert.equal(decryptToken("legacy-plaintext-token"), "legacy-plaintext-token");
    });
});

test("passport OAuth persistence encrypts tokens and preserves existing refresh token", async (t) => {
    await withTokenKey(async () => {
        const encryptedRefreshToken = encryptToken("existing-refresh-token");
        let savedTokens = null;

        t.mock.method(User, "findOne", () => ({
            select: async (fields) => {
                assert.match(fields, /\+tokens\.refresh_token/);
                return {
                    _id: "64b000000000000000000010",
                    tokens: {
                        refresh_token: encryptedRefreshToken,
                        expiry_date: Date.now() + 60_000
                    }
                };
            }
        }));
        t.mock.method(User, "findOneAndUpdate", async (filter, update) => {
            assert.equal(filter.googleId, "google-1");
            savedTokens = update.tokens;
            return { _id: "64b000000000000000000010" };
        });
        t.mock.method(User, "findById", async () => ({
            _id: "64b000000000000000000010",
            googleId: "google-1",
            name: "Test User",
            email: "test@example.com"
        }));

        const user = await passportConfig.upsertGoogleOAuthUser({
            accessToken: "new-access-token",
            refreshToken: undefined,
            profile: {
                id: "google-1",
                displayName: "Test User",
                emails: [{ value: "test@example.com" }],
                photos: [{ value: "https://example.test/avatar.png" }]
            }
        });

        assert.equal(user.tokens, undefined);
        assert.equal(isEncryptedToken(savedTokens.access_token), true);
        assert.equal(isEncryptedToken(savedTokens.refresh_token), true);
        assert.equal(decryptToken(savedTokens.access_token), "new-access-token");
        assert.equal(decryptToken(savedTokens.refresh_token), "existing-refresh-token");
    });
});

test("getValidAccessToken decrypts legacy tokens and stores refreshed tokens encrypted", async (t) => {
    await withTokenKey(async () => {
        let savedTokens = null;

        t.mock.method(User, "findById", () => ({
            select: async (fields) => {
                assert.match(fields, /\+tokens\.access_token/);
                return {
                    _id: "64b000000000000000000010",
                    tokens: {
                        access_token: "legacy-expired-access",
                        refresh_token: "legacy-refresh-token",
                        expiry_date: Date.now() - 10_000
                    }
                };
            }
        }));
        t.mock.method(User, "findByIdAndUpdate", async (userId, update) => {
            assert.equal(String(userId), "64b000000000000000000010");
            savedTokens = update.$set.tokens;
            return {};
        });
        t.mock.method(google.auth, "OAuth2", function OAuth2Mock() {
            return {
                setCredentials(credentials) {
                    assert.equal(credentials.refresh_token, "legacy-refresh-token");
                },
                async refreshAccessToken() {
                    return {
                        credentials: {
                            access_token: "refreshed-access-token",
                            expiry_date: Date.now() + 3600 * 1000
                        }
                    };
                }
            };
        });

        const accessToken = await getValidAccessToken("64b000000000000000000010");

        assert.equal(accessToken, "refreshed-access-token");
        assert.equal(isEncryptedToken(savedTokens.access_token), true);
        assert.equal(isEncryptedToken(savedTokens.refresh_token), true);
        assert.equal(decryptToken(savedTokens.access_token), "refreshed-access-token");
        assert.equal(decryptToken(savedTokens.refresh_token), "legacy-refresh-token");
    });
});

test("production OAuth token encryption key validation fails closed", () => {
    assert.throws(
        () => validateOauthTokenEncryptionKey(undefined),
        /OAUTH_TOKEN_ENCRYPTION_KEY/
    );
    assert.throws(
        () => validateOauthTokenEncryptionKey(Buffer.from("too-short").toString("base64")),
        /Invalid OAUTH_TOKEN_ENCRYPTION_KEY/
    );
    assert.doesNotThrow(() => validateOauthTokenEncryptionKey(tokenKey));
});

test("validateEnv requires OAuth token encryption key in production", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousClientProdUrl = process.env.CLIENT_PROD_URL;
    const previousKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

    process.env.NODE_ENV = "production";
    process.env.CLIENT_PROD_URL = "https://example.test";
    delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

    try {
        assert.throws(
            () => validateEnv(),
            /OAUTH_TOKEN_ENCRYPTION_KEY/
        );
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
        if (previousClientProdUrl === undefined) delete process.env.CLIENT_PROD_URL;
        else process.env.CLIENT_PROD_URL = previousClientProdUrl;
        if (previousKey === undefined) delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
        else process.env.OAUTH_TOKEN_ENCRYPTION_KEY = previousKey;
    }
});

test("prompt DTO normalizes legacy gender text", () => {
    const dto = toPromptDto({
        _id: "64b000000000000000000001",
        channelTheme: "education",
        genderText: "You are a woman.",
        generalPrompt: "prompt"
    });

    assert.equal(dto.gender, "female");
});

test("validators reject malformed bot input", () => {
    assert.equal(validateVideoId("abcDEF123_-"), "abcDEF123_-");
    assert.throws(() => validateVideoId("https://youtube.com/watch?v=abcDEF123_-"));
    assert.equal(validateGender("male"), "male");
    assert.throws(() => validateGender("You are a man."));
    assert.throws(() => validatePrompt("x".repeat(1201)));
    assert.equal(validateIdempotencyKey("abcDEF123_4567890"), "abcDEF123_4567890");
});

test("Gemini reply validation rejects unsafe output shapes", () => {
    assert.equal(validateGeneratedReply("  Thanks!\n\nGood point. "), "Thanks! Good point.");
    assert.throws(() => validateGeneratedReply(""));
    assert.throws(() => validateGeneratedReply("x".repeat(501)));
});
