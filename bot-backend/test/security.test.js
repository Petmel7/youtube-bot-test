const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const { google } = require("googleapis");

const { toSafeUser, toPromptDto } = require("../src/utils/dto");
const User = require("../src/models/User");
const { getValidAccessToken } = require("../src/services/authService");
const { encryptToken, decryptToken, isEncryptedToken } = require("../src/services/security/tokenCrypto");
const passportConfig = require("../src/config/passport");
const validateEnv = require("../src/config/validateEnv");
const { validateOauthTokenEncryptionKey, validateMongoUri } = validateEnv;
const requireWriteHeader = require("../src/middleware/requireWriteHeader");
const { createCsrfToken } = require("../src/services/security/csrfService");
const { createRateLimiter, resetRateLimitStores } = require("../src/middleware/rateLimit");
const { createHealthRoutes } = require("../src/routes/healthRoutes");
const errorHandler = require("../src/middleware/errorHandler");
const {
    validateVideoId,
    validateGender,
    validatePrompt,
    validateIdempotencyKey
} = require("../src/utils/validators");
const { validateGeneratedReply } = require("../src/services/geminiService");

const tokenKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

const request = async (app, { method = "GET", path, headers = {} }) => {
    const server = app.listen(0);
    try {
        const port = server.address().port;
        return await new Promise((resolve, reject) => {
            const req = http.request({
                hostname: "127.0.0.1",
                port,
                path,
                method,
                headers
            }, (res) => {
                let body = "";
                res.on("data", chunk => { body += chunk; });
                res.on("end", () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: body ? JSON.parse(body) : {}
                    });
                });
            });
            req.on("error", reject);
            req.end();
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
};

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

test("production MongoDB URI validation requires an explicit non-test database", () => {
    assert.throws(
        () => validateMongoUri("mongodb+srv://user:pass@example.mongodb.net/", { nodeEnv: "production" }),
        /MONGO_URI database name/
    );
    assert.throws(
        () => validateMongoUri("mongodb://localhost:27017/test", { nodeEnv: "production" }),
        /MONGO_URI database name/
    );
    assert.equal(
        validateMongoUri("mongodb://localhost:27017/youtube_bot_prod", { nodeEnv: "production" }),
        "youtube_bot_prod"
    );
    assert.equal(
        validateMongoUri("mongodb://localhost:27017/test", { nodeEnv: "development" }),
        "test"
    );
    assert.throws(
        () => validateMongoUri("mongodb://localhost:27017/wrong", {
            nodeEnv: "production",
            expectedDbName: "youtube_bot_prod"
        }),
        /MONGO_URI database name/
    );
});

test("requireWriteHeader accepts valid session CSRF token and rejects invalid tokens in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
        const req = {
            session: {},
            get(name) {
                return this.headers?.[name.toLowerCase()];
            },
            headers: {}
        };
        const token = createCsrfToken(req);
        let nextError = null;
        let nextCalled = false;

        req.headers["x-csrf-token"] = token;
        requireWriteHeader(req, {}, (error) => {
            nextError = error || null;
            nextCalled = true;
        });
        assert.equal(nextCalled, true);
        assert.equal(nextError, null);

        req.headers["x-csrf-token"] = "wrong-token";
        requireWriteHeader(req, {}, (error) => {
            nextError = error || null;
        });
        assert.equal(nextError.code, "CSRF_TOKEN_INVALID");
        assert.equal(nextError.status, 403);

        delete req.headers["x-csrf-token"];
        req.headers["x-csrf-protection"] = "1";
        requireWriteHeader(req, {}, (error) => {
            nextError = error || null;
        });
        assert.equal(nextError.code, "CSRF_TOKEN_REQUIRED");
    } finally {
        if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previousNodeEnv;
    }
});

test("rate limiter scopes authenticated users separately and returns Retry-After", async () => {
    resetRateLimitStores();
    const app = express();
    app.use((req, res, next) => {
        const userId = req.get("X-Test-User");
        if (userId) req.user = { _id: userId };
        next();
    });
    app.use(createRateLimiter({
        group: "test-bot",
        windowMs: 60000,
        max: 1,
        logger: { warn() {} }
    }));
    app.get("/limited", (req, res) => res.json({ success: true }));
    app.use(errorHandler);

    const first = await request(app, { path: "/limited", headers: { "X-Test-User": "user-1" } });
    const second = await request(app, { path: "/limited", headers: { "X-Test-User": "user-1" } });
    const otherUser = await request(app, { path: "/limited", headers: { "X-Test-User": "user-2" } });

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, "RATE_LIMITED");
    assert.equal(Boolean(second.headers["retry-after"]), true);
    assert.equal(otherUser.status, 200);
});

test("rate limiter falls back to IP for unauthenticated clients", async () => {
    resetRateLimitStores();
    const app = express();
    app.set("trust proxy", true);
    app.use(createRateLimiter({
        group: "test-ip",
        windowMs: 60000,
        max: 1,
        logger: { warn() {} }
    }));
    app.get("/limited", (req, res) => res.json({ success: true }));
    app.use(errorHandler);

    const first = await request(app, { path: "/limited", headers: { "X-Forwarded-For": "203.0.113.10" } });
    const second = await request(app, { path: "/limited", headers: { "X-Forwarded-For": "203.0.113.10" } });
    const otherIp = await request(app, { path: "/limited", headers: { "X-Forwarded-For": "203.0.113.11" } });

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, "RATE_LIMITED");
    assert.equal(otherIp.status, 200);
});

test("health and readiness endpoints are unauthenticated and do not expose secrets", async () => {
    const readyApp = express();
    readyApp.use(createHealthRoutes({ connection: { readyState: 1 } }));

    const health = await request(readyApp, { path: "/healthz" });
    const ready = await request(readyApp, { path: "/readyz" });

    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: "ok" });
    assert.equal(ready.status, 200);
    assert.deepEqual(ready.body, { status: "ready" });

    const notReadyApp = express();
    notReadyApp.use(createHealthRoutes({ connection: { readyState: 0 } }));
    const notReady = await request(notReadyApp, { path: "/readyz" });

    assert.equal(notReady.status, 503);
    assert.deepEqual(notReady.body, { status: "not_ready" });
    assert.equal(JSON.stringify(notReady.body).includes("MONGO_URI"), false);
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
