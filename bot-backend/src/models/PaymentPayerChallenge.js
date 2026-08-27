const mongoose = require("mongoose");

const evmAddressPattern = /^0x[a-f0-9]{40}$/;
const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const paymentPayerChallengeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
    paymentMethodId: { type: String, required: true, immutable: true, match: /^[A-Za-z0-9_-]{1,80}$/ },
    namespace: { type: String, enum: ["eip155", "solana"], default: "eip155", required: true, immutable: true },
    networkId: { type: String, required: true, immutable: true },
    caipNetworkId: { type: String, required: true, immutable: true },
    chainId: { type: Number, default: null, immutable: true },
    tokenSymbol: { type: String, required: true, immutable: true },
    payerAddress: {
        type: String,
        required: true,
        immutable: true,
        validate: {
            validator(value) {
                return this.namespace === "solana"
                    ? solanaAddressPattern.test(value)
                    : evmAddressPattern.test(value);
            },
            message: "Invalid payer address"
        }
    },
    nonce: { type: String, required: true, unique: true, immutable: true },
    message: { type: String, required: true, immutable: true },
    expiresAt: { type: Date, required: true, immutable: true },
    usedAt: { type: Date, default: null }
}, { timestamps: true });

paymentPayerChallengeSchema.index({ userId: 1, paymentMethodId: 1, namespace: 1, payerAddress: 1, createdAt: -1 });
paymentPayerChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

const PaymentPayerChallenge = mongoose.model("PaymentPayerChallenge", paymentPayerChallengeSchema, "paymentpayerchallenges");

module.exports = PaymentPayerChallenge;
