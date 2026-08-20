const mongoose = require("mongoose");

const evmAddressPattern = /^0x[a-f0-9]{40}$/;

const paymentPayerChallengeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
    payerAddress: { type: String, required: true, match: evmAddressPattern, immutable: true },
    nonce: { type: String, required: true, unique: true, immutable: true },
    message: { type: String, required: true, immutable: true },
    expiresAt: { type: Date, required: true, immutable: true },
    usedAt: { type: Date, default: null }
}, { timestamps: true });

paymentPayerChallengeSchema.index({ userId: 1, payerAddress: 1, createdAt: -1 });
paymentPayerChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

const PaymentPayerChallenge = mongoose.model("PaymentPayerChallenge", paymentPayerChallengeSchema, "paymentpayerchallenges");

module.exports = PaymentPayerChallenge;
