const mongoose = require("mongoose");
const { aiCreditUnit } = require("../config/config");

const nonNegativeInteger = {
    validator: Number.isInteger,
    message: "{PATH} must be an integer"
};

const walletSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    balance: { type: Number, required: true, default: 0, min: 0, validate: nonNegativeInteger },
    reserved: { type: Number, required: true, default: 0, min: 0, validate: nonNegativeInteger },
    unit: { type: String, required: true, default: aiCreditUnit }
}, { timestamps: true });

const Wallet = mongoose.model("Wallet", walletSchema, "wallets");

module.exports = Wallet;
