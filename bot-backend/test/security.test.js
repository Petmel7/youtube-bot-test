const test = require("node:test");
const assert = require("node:assert/strict");

const { toSafeUser, toPromptDto } = require("../src/utils/dto");
const {
    validateVideoId,
    validateGender,
    validatePrompt,
    validateIdempotencyKey
} = require("../src/utils/validators");
const { validateGeneratedReply } = require("../src/services/geminiService");

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
