const crypto = require("node:crypto");

const TOKEN_PREFIX = "enc:v1";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const getKey = () => {
    const oauthTokenEncryptionKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    if (!oauthTokenEncryptionKey) return null;

    try {
        const key = Buffer.from(oauthTokenEncryptionKey, "base64");
        return key.length === 32 ? key : null;
    } catch {
        return null;
    }
};

const isEncryptedToken = (value) => typeof value === "string" && value.startsWith(`${TOKEN_PREFIX}:`);

const encryptToken = (value) => {
    if (value === undefined || value === null || value === "") return value;

    const key = getKey();
    if (!key) return value;

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
        TOKEN_PREFIX,
        iv.toString("base64"),
        authTag.toString("base64"),
        ciphertext.toString("base64")
    ].join(":");
};

const decryptToken = (value) => {
    if (value === undefined || value === null || value === "") return value;
    if (!isEncryptedToken(value)) return value;

    const key = getKey();
    if (!key) {
        throw new Error("OAuth token encryption key is required to decrypt stored tokens");
    }

    const [, , ivBase64, authTagBase64, ciphertextBase64] = value.split(":");
    if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
        throw new Error("Invalid encrypted OAuth token payload");
    }

    const iv = Buffer.from(ivBase64, "base64");
    const authTag = Buffer.from(authTagBase64, "base64");
    const ciphertext = Buffer.from(ciphertextBase64, "base64");

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
};

module.exports = {
    TOKEN_PREFIX,
    encryptToken,
    decryptToken,
    isEncryptedToken
};
