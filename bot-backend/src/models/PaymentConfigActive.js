const mongoose = require("mongoose");

const activeMethodSchema = new mongoose.Schema({
    id: { type: String, required: true },
    enabled: { type: Boolean, required: true },
    treasuryAddress: { type: String, required: true },
    confirmations: { type: Number, required: true }
}, { _id: false });

const paymentConfigActiveSchema = new mongoose.Schema({
    version: { type: Number, required: true, unique: true },
    source: { type: String, required: true, default: "db-proposal" },
    methods: { type: [activeMethodSchema], required: true, default: undefined },
    defaultMethodId: { type: String, default: null },
    activatedProposalId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentConfigProposal", required: true },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, {
    strict: true,
    timestamps: { createdAt: true, updatedAt: false }
});

paymentConfigActiveSchema.index({ createdAt: -1 });

const PaymentConfigActive = mongoose.model("PaymentConfigActive", paymentConfigActiveSchema, "paymentconfigactive");

module.exports = PaymentConfigActive;
