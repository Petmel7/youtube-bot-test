const mongoose = require("mongoose");
const { aiCreditUnit } = require("../config/config");

const immutableString = { type: String, required: true, immutable: true };
const immutableNumber = { type: Number, required: true, immutable: true };
const immutableOptionalNumber = { type: Number, default: null, immutable: true };
const immutableOptionalObjectId = { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true };
const txHashPattern = /^0x[a-f0-9]{64}$/;
const nullablePositiveInteger = {
    validator: (value) => value === null || (Number.isInteger(value) && value > 0),
    message: "{PATH} must be a positive integer"
};

const walletTransactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
    walletId: { type: mongoose.Schema.Types.ObjectId, ref: "Wallet", required: true, immutable: true },
    type: {
        ...immutableString,
        enum: ["CREDIT", "DEBIT", "RESERVATION", "RELEASE", "REFUND", "ADJUSTMENT"]
    },
    amount: { ...immutableNumber, min: 0 },
    unit: { type: String, required: true, default: aiCreditUnit, immutable: true },
    balanceBefore: immutableOptionalNumber,
    balanceAfter: immutableOptionalNumber,
    reservedBefore: immutableOptionalNumber,
    reservedAfter: immutableOptionalNumber,
    referenceType: immutableString,
    referenceId: immutableString,
    reservationKey: { type: String, default: null, index: true, immutable: true },
    paymentIntentId: { ...immutableOptionalObjectId, ref: "PaymentIntent" },
    chainId: { type: Number, default: null, immutable: true, validate: nullablePositiveInteger },
    txHash: { type: String, default: null, immutable: true, match: txHashPattern },
    idempotencyKey: { type: String, required: true, unique: true, immutable: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

walletTransactionSchema.index({ userId: 1, createdAt: -1 });
walletTransactionSchema.index(
    { reservationKey: 1, type: 1 },
    { unique: true, partialFilterExpression: { reservationKey: { $type: "string" } } }
);
walletTransactionSchema.index(
    { paymentIntentId: 1, type: 1 },
    { unique: true, partialFilterExpression: { type: "CREDIT", paymentIntentId: { $type: "objectId" } } }
);
walletTransactionSchema.index(
    { chainId: 1, txHash: 1, type: 1 },
    { unique: true, partialFilterExpression: { type: "CREDIT", chainId: { $type: "number" }, txHash: { $type: "string" } } }
);

const WalletTransaction = mongoose.model("WalletTransaction", walletTransactionSchema, "wallettransactions");

module.exports = WalletTransaction;
