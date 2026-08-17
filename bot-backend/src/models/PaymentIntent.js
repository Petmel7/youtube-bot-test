const mongoose = require("mongoose");

const immutableString = { type: String, required: true, immutable: true };
const immutableNumber = { type: Number, required: true, immutable: true };
const nullableString = { type: String, default: null };
const nullableNumber = { type: Number, default: null };
const nullableObjectId = { type: mongoose.Schema.Types.ObjectId, default: null };

const paymentIntentStatuses = [
    "PENDING",
    "SUBMITTED",
    "VERIFYING",
    "CONFIRMING",
    "CONFIRMED",
    "CONFIRMED_OVERPAID",
    "UNDERPAID",
    "EXPIRED",
    "FAILED",
    "REJECTED",
    "CANCELLED"
];

const canonicalDecimalStringPattern = /^(0|[1-9][0-9]*)$/;
const evmAddressPattern = /^0x[a-f0-9]{40}$/;
const txHashPattern = /^0x[a-f0-9]{64}$/;
const positiveInteger = {
    validator: (value) => Number.isInteger(value) && value > 0,
    message: "{PATH} must be a positive integer"
};
const positiveSafeInteger = {
    validator: (value) => Number.isSafeInteger(value) && value > 0,
    message: "{PATH} must be a positive integer"
};
const nonNegativeInteger = {
    validator: (value) => value === null || (Number.isInteger(value) && value >= 0),
    message: "{PATH} must be a non-negative integer"
};
const canonicalDecimalString = {
    validator: (value) => canonicalDecimalStringPattern.test(value) && BigInt(value) > 0n,
    message: "{PATH} must be a positive canonical decimal string"
};
const nullableCanonicalDecimalString = {
    validator: (value) => value === null || (canonicalDecimalStringPattern.test(value) && BigInt(value) >= 0n),
    message: "{PATH} must be a canonical decimal string"
};

const paymentIntentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
    idempotencyKey: immutableString,
    packageId: immutableString,

    chainId: { ...immutableNumber, validate: positiveInteger },
    tokenAddress: { ...immutableString, match: evmAddressPattern },
    tokenSymbol: immutableString,
    tokenDecimals: { ...immutableNumber, min: 0 },
    recipientAddress: { ...immutableString, match: evmAddressPattern },
    expectedTokenAmountBaseUnits: { ...immutableString, validate: canonicalDecimalString },
    expectedUsdAmountMinor: { ...immutableNumber, validate: positiveSafeInteger },
    creditAmount: { ...immutableNumber, validate: positiveSafeInteger },
    pricingVersion: immutableString,

    status: {
        type: String,
        enum: paymentIntentStatuses,
        default: "PENDING",
        required: true
    },
    txHash: { ...nullableString, match: txHashPattern },
    fromAddress: { ...nullableString, match: evmAddressPattern },
    firstSeenBlock: { ...nullableNumber, validate: nonNegativeInteger },
    confirmedBlock: { ...nullableNumber, validate: nonNegativeInteger },
    confirmationCount: { ...nullableNumber, validate: nonNegativeInteger },
    verifiedTokenAmountBaseUnits: { ...nullableString, validate: nullableCanonicalDecimalString },
    transactionStatus: nullableString,

    expiresAt: { type: Date, required: true, immutable: true },
    confirmedAt: { type: Date, default: null },
    creditedTransactionId: { ...nullableObjectId, ref: "WalletTransaction" },
    overpaidAmountBaseUnits: { ...nullableString, validate: nullableCanonicalDecimalString },
    failureCode: nullableString,
    failureReason: nullableString
}, {
    strict: true,
    timestamps: true
});

paymentIntentSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
paymentIntentSchema.index(
    { chainId: 1, txHash: 1 },
    { unique: true, partialFilterExpression: { txHash: { $type: "string" } } }
);
paymentIntentSchema.index({ userId: 1, createdAt: -1 });
paymentIntentSchema.index({ creditedTransactionId: 1 });
paymentIntentSchema.index({ status: 1, updatedAt: 1 });
paymentIntentSchema.index({ status: 1, expiresAt: 1 });

const PaymentIntent = mongoose.model("PaymentIntent", paymentIntentSchema, "paymentintents");

module.exports = PaymentIntent;
module.exports.paymentIntentStatuses = paymentIntentStatuses;
