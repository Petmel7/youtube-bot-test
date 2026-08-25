const crypto = require("node:crypto");
const { verifyMessage } = require("ethers");

const PaymentPayerChallenge = require("../../models/PaymentPayerChallenge");
const { conflict, notFound, unprocessable } = require("../../utils/errors");
const { normalizeEvmAddress } = require("../../utils/evmAddress");
const { normalizeSolanaAddress, verifySolanaMessageSignature } = require("../../utils/solana");

const CHALLENGE_TTL_MINUTES = 10;
const APP_NAME = "YouTube Bot";
const PURPOSE = "Bind this wallet as payer for YouTube Bot credit purchase";

const addSession = (query, session) => session ? query.session(session) : query;
const idsEqual = (left, right) => String(left || "") === String(right || "");

const buildChallengeMessage = ({ userId, payerAddress, namespace = "eip155", nonce, expiresAt }) => [
    APP_NAME,
    PURPOSE,
    `User ID: ${userId}`,
    `Namespace: ${namespace}`,
    `Payer address: ${payerAddress}`,
    `Nonce: ${nonce}`,
    `Expires at: ${expiresAt.toISOString()}`
].join("\n");

const normalizeNamespace = (namespace = "eip155") => {
    if (namespace === "eip155" || namespace === "solana") return namespace;
    throw unprocessable("INVALID_PAYER_NAMESPACE", "Invalid payer namespace");
};

const normalizePayerAddress = ({ namespace, payerAddress }) => {
    if (namespace === "solana") {
        const normalized = normalizeSolanaAddress(payerAddress);
        if (!normalized) throw unprocessable("INVALID_PAYER_ADDRESS", "Invalid payer address");
        return normalized;
    }

    const normalized = normalizeEvmAddress(payerAddress);
    if (!normalized) throw unprocessable("INVALID_PAYER_ADDRESS", "Invalid payer address");
    return normalized;
};

const createPaymentPayerChallengeService = ({
    ChallengeModel = PaymentPayerChallenge,
    nonceBytes = 24,
    now = () => new Date(),
    randomBytes = crypto.randomBytes,
    recoverAddress = verifyMessage,
    verifySolanaSignature = verifySolanaMessageSignature
} = {}) => {
    const createChallenge = async ({ userId, payerAddress, namespace = "eip155" }) => {
        const normalizedNamespace = normalizeNamespace(namespace);
        const normalizedPayerAddress = normalizePayerAddress({ namespace: normalizedNamespace, payerAddress });

        const nonce = randomBytes(nonceBytes).toString("hex");
        const createdAt = now();
        const expiresAt = new Date(createdAt.getTime() + CHALLENGE_TTL_MINUTES * 60 * 1000);
        const message = buildChallengeMessage({
            userId,
            namespace: normalizedNamespace,
            payerAddress: normalizedPayerAddress,
            nonce,
            expiresAt
        });

        const [challenge] = await ChallengeModel.create([{
            userId,
            namespace: normalizedNamespace,
            payerAddress: normalizedPayerAddress,
            nonce,
            message,
            expiresAt
        }]);

        return { challenge };
    };

    const verifyAndUseChallenge = async ({ userId, payerChallengeId, signature }, { session } = {}) => {
        if (!payerChallengeId || typeof payerChallengeId !== "string") {
            throw unprocessable("INVALID_PAYER_CHALLENGE", "Invalid payer challenge");
        }

        if (!signature || typeof signature !== "string" || signature.length > 512) {
            throw unprocessable("INVALID_PAYER_SIGNATURE", "Invalid payer signature");
        }

        const challenge = await addSession(ChallengeModel.findOne({
            _id: payerChallengeId,
            userId
        }), session);

        if (!challenge) {
            throw notFound("PAYER_CHALLENGE_NOT_FOUND", "Payer challenge was not found");
        }

        if (challenge.usedAt) {
            throw conflict("PAYER_CHALLENGE_USED", "Payer challenge was already used");
        }

        if (challenge.expiresAt.getTime() <= now().getTime()) {
            throw conflict("PAYER_CHALLENGE_EXPIRED", "Payer challenge expired");
        }

        let recoveredAddress;
        try {
            if (challenge.namespace === "solana") {
                recoveredAddress = verifySolanaSignature({
                    message: challenge.message,
                    signature,
                    payerAddress: challenge.payerAddress
                }) ? challenge.payerAddress : null;
            } else {
                recoveredAddress = normalizeEvmAddress(recoverAddress(challenge.message, signature));
            }
        } catch {
            throw unprocessable("INVALID_PAYER_SIGNATURE", "Invalid payer signature");
        }

        if (!recoveredAddress || recoveredAddress !== challenge.payerAddress) {
            throw unprocessable("INVALID_PAYER_SIGNATURE", "Invalid payer signature");
        }

        const usedAt = now();
        const usedChallenge = await addSession(ChallengeModel.findOneAndUpdate(
            {
                _id: challenge._id,
                userId,
                usedAt: null,
                expiresAt: { $gt: usedAt }
            },
            { $set: { usedAt } },
            { new: true }
        ), session);

        if (!usedChallenge) {
            const latest = await addSession(ChallengeModel.findOne({ _id: challenge._id, userId }), session);
            if (latest?.usedAt) {
                throw conflict("PAYER_CHALLENGE_USED", "Payer challenge was already used");
            }
            throw conflict("PAYER_CHALLENGE_EXPIRED", "Payer challenge expired");
        }

        if (!idsEqual(usedChallenge.userId, userId)) {
            throw notFound("PAYER_CHALLENGE_NOT_FOUND", "Payer challenge was not found");
        }

        return {
            challenge: usedChallenge,
            payerAddress: usedChallenge.payerAddress
        };
    };

    return {
        createChallenge,
        verifyAndUseChallenge
    };
};

module.exports = createPaymentPayerChallengeService();
module.exports.createPaymentPayerChallengeService = createPaymentPayerChallengeService;
module.exports.buildChallengeMessage = buildChallengeMessage;
