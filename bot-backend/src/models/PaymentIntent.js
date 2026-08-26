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
    "MANUAL_REVIEW_REQUIRED",
    "EXPIRED",
    "FAILED",
    "REJECTED",
    "CANCELLED"
];

const canonicalDecimalStringPattern = /^(0|[1-9][0-9]*)$/;
const evmAddressPattern = /^0x[a-f0-9]{40}$/;
const txHashPattern = /^0x[a-f0-9]{64}$/;
const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const solanaSignaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,128}$/;
const txIdentifierPattern = /^(0x[a-f0-9]{64}|[1-9A-HJ-NP-Za-km-z]{64,128})$/;
const paymentMethodIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
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

const creditedTransactionIdWriteOnceError = () => Object.assign(
    new Error("creditedTransactionId is write-once after assignment"),
    { code: "PAYMENT_CREDITED_TRANSACTION_WRITE_ONCE" }
);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const idsEqual = (left, right) => String(left || "") === String(right || "");

const guardCreditedTransactionIdUpdate = function guardCreditedTransactionIdUpdate(next) {
    const update = this.getUpdate() || {};
    const setUpdate = update.$set || {};
    const unsetUpdate = update.$unset || {};
    const setsCreditedTransactionId = hasOwn(setUpdate, "creditedTransactionId") || hasOwn(update, "creditedTransactionId");
    const unsetsCreditedTransactionId = hasOwn(unsetUpdate, "creditedTransactionId");

    if (!setsCreditedTransactionId && !unsetsCreditedTransactionId) {
        return next();
    }

    if (unsetsCreditedTransactionId) {
        return next(creditedTransactionIdWriteOnceError());
    }

    const value = hasOwn(setUpdate, "creditedTransactionId")
        ? setUpdate.creditedTransactionId
        : update.creditedTransactionId;
    const filter = this.getFilter() || {};

    if (!value || filter.creditedTransactionId !== null) {
        return next(creditedTransactionIdWriteOnceError());
    }

    return next();
};

const guardCreditedTransactionIdSave = async function guardCreditedTransactionIdSave(next) {
    if (this.isNew || !this.isModified("creditedTransactionId")) {
        return next();
    }

    const existing = await this.constructor
        .findById(this._id)
        .select("creditedTransactionId")
        .session(this.$session());

    if (
        existing?.creditedTransactionId &&
        (!this.creditedTransactionId || !idsEqual(existing.creditedTransactionId, this.creditedTransactionId))
    ) {
        return next(creditedTransactionIdWriteOnceError());
    }

    return next();
};

guardCreditedTransactionIdSave.document = true;
guardCreditedTransactionIdSave.query = false;

const paymentIntentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
    idempotencyKey: immutableString,
    packageId: immutableString,
    paymentMethodId: { ...immutableString, match: paymentMethodIdPattern },
    namespace: { type: String, enum: ["eip155", "solana"], default: "eip155", required: true, immutable: true },
    paymentMethodSnapshot: {
        id: { ...immutableString, match: paymentMethodIdPattern },
        name: immutableString,
        namespace: { type: String, enum: ["eip155", "solana"], default: "eip155", required: true, immutable: true },
        network: immutableString,
        networkId: { type: String, default: null, immutable: true },
        caipNetworkId: { type: String, default: null, immutable: true },
        cluster: nullableString,
        chainId: { type: Number, default: null, immutable: true },
        rpcUrl: immutableString,
        assetType: { type: String, default: "erc20", immutable: true },
        assetProvenance: nullableString,
        tokenAddress: { type: String, default: null, immutable: true },
        mintAddress: { type: String, default: null, immutable: true },
        tokenSymbol: immutableString,
        tokenDecimals: { ...immutableNumber, min: 0 },
        treasuryAddress: immutableString,
        confirmations: { ...immutableNumber, validate: positiveInteger },
        production: { type: Boolean, default: null, immutable: true },
        testnet: { type: Boolean, default: false, immutable: true },
        smoke: { type: Boolean, default: false, immutable: true }
    },

    networkId: { type: String, default: null, immutable: true },
    chainId: { type: Number, default: null, immutable: true, validate: nonNegativeInteger },
    tokenAddress: { type: String, default: null, immutable: true },
    mintAddress: { type: String, default: null, immutable: true },
    tokenSymbol: immutableString,
    tokenDecimals: { ...immutableNumber, min: 0 },
    recipientAddress: immutableString,
    expectedTokenAmountBaseUnits: { ...immutableString, validate: canonicalDecimalString },
    expectedUsdAmountMinor: { ...immutableNumber, validate: positiveSafeInteger },
    creditAmount: { ...immutableNumber, validate: positiveSafeInteger },
    pricingVersion: immutableString,
    payerAddress: immutableString,
    payerChallengeId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentPayerChallenge", required: true, immutable: true },

    status: {
        type: String,
        enum: paymentIntentStatuses,
        default: "PENDING",
        required: true
    },
    candidateTxHash: { ...nullableString, match: txIdentifierPattern },
    txHash: { ...nullableString, match: txIdentifierPattern },
    transactionSignature: { ...nullableString, match: solanaSignaturePattern },
    fromAddress: nullableString,
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
paymentIntentSchema.index({ paymentMethodId: 1, createdAt: -1 });
paymentIntentSchema.index({ userId: 1, payerAddress: 1, createdAt: -1 });
paymentIntentSchema.index(
    { namespace: 1, networkId: 1, txHash: 1 },
    { unique: true, partialFilterExpression: { txHash: { $type: "string" } } }
);
paymentIntentSchema.index({ userId: 1, createdAt: -1 });
paymentIntentSchema.index({ creditedTransactionId: 1 });
paymentIntentSchema.index({ status: 1, updatedAt: 1 });
paymentIntentSchema.index({ status: 1, expiresAt: 1 });

paymentIntentSchema.pre("findOneAndUpdate", guardCreditedTransactionIdUpdate);
paymentIntentSchema.pre("updateOne", guardCreditedTransactionIdUpdate);
paymentIntentSchema.pre("updateMany", guardCreditedTransactionIdUpdate);
paymentIntentSchema.pre("save", guardCreditedTransactionIdSave);

const PaymentIntent = mongoose.model("PaymentIntent", paymentIntentSchema, "paymentintents");

module.exports = PaymentIntent;
module.exports.paymentIntentStatuses = paymentIntentStatuses;
module.exports.guardCreditedTransactionIdUpdate = guardCreditedTransactionIdUpdate;
module.exports.guardCreditedTransactionIdSave = guardCreditedTransactionIdSave;
