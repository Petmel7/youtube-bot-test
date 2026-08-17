const mongoose = require("mongoose");
const { aiCreditUnit } = require("../config/config");

const immutableString = { type: String, required: true, immutable: true };
const immutableNumber = { type: Number, required: true, immutable: true };
const immutableOptionalNumber = { type: Number, default: null, immutable: true };

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
    idempotencyKey: { type: String, required: true, unique: true, immutable: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined, immutable: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

walletTransactionSchema.index({ userId: 1, createdAt: -1 });

const WalletTransaction = mongoose.model("WalletTransaction", walletTransactionSchema, "wallettransactions");

module.exports = WalletTransaction;
