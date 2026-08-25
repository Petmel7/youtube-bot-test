const crypto = require("node:crypto");

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));
const SOLANA_PUBLIC_KEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;

const decodeBase58 = (value) => {
    if (typeof value !== "string" || value.length === 0) return null;

    let bytes = [0];
    for (const char of value) {
        const digit = BASE58_VALUES.get(char);
        if (digit === undefined) return null;

        let carry = digit;
        for (let index = 0; index < bytes.length; index += 1) {
            carry += bytes[index] * 58;
            bytes[index] = carry & 0xff;
            carry >>= 8;
        }

        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }

    for (const char of value) {
        if (char !== "1") break;
        bytes.push(0);
    }

    return Buffer.from(bytes.reverse());
};

const isValidSolanaPublicKey = (value) => {
    if (!SOLANA_PUBLIC_KEY_RE.test(String(value || ""))) return false;
    const decoded = decodeBase58(value);
    return decoded?.length === 32;
};

const isValidSolanaSignature = (value) => {
    if (!SOLANA_SIGNATURE_RE.test(String(value || ""))) return false;
    const decoded = decodeBase58(value);
    return decoded?.length === 64;
};

const normalizeSolanaAddress = (value) => {
    const trimmed = String(value || "").trim();
    return isValidSolanaPublicKey(trimmed) ? trimmed : null;
};

const verifySolanaMessageSignature = ({ message, signature, payerAddress }) => {
    const publicKey = decodeBase58(payerAddress);
    const decodedSignature = Buffer.from(String(signature || ""), "base64");

    if (publicKey?.length !== 32 || decodedSignature.length !== 64) {
        return false;
    }

    const spki = Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        publicKey
    ]);
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });

    return crypto.verify(null, Buffer.from(message), key, decodedSignature);
};

module.exports = {
    SOLANA_PUBLIC_KEY_RE,
    SOLANA_SIGNATURE_RE,
    decodeBase58,
    isValidSolanaPublicKey,
    isValidSolanaSignature,
    normalizeSolanaAddress,
    verifySolanaMessageSignature
};
