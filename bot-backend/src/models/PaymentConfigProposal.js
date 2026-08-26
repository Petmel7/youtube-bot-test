const mongoose = require("mongoose");

const proposalStatuses = [
    "DRAFT",
    "PENDING_CONFIRMATION",
    "PENDING_APPROVAL",
    "APPROVED",
    "ACTIVATED",
    "REJECTED",
    "CANCELLED",
    "EXPIRED"
];

const methodChangeSchema = new mongoose.Schema({
    methodId: { type: String, required: true },
    enabled: { type: Boolean, default: undefined },
    treasuryAddress: { type: String, default: undefined },
    confirmations: { type: Number, default: undefined }
}, { _id: false });

const paymentConfigProposalSchema = new mongoose.Schema({
    status: { type: String, enum: proposalStatuses, required: true, default: "PENDING_CONFIRMATION", index: true },
    proposedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    methodChanges: { type: [methodChangeSchema], required: true, default: undefined },
    normalizedPreview: { type: mongoose.Schema.Types.Mixed, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    confirmationPhrase: { type: String, required: true, default: "CONFIRM PAYMENT CONFIG CHANGE" },
    expiresAt: { type: Date, required: true, index: true },
    confirmedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    activatedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null }
}, {
    strict: true,
    timestamps: true
});

paymentConfigProposalSchema.index({ status: 1, createdAt: -1 });
paymentConfigProposalSchema.index({ proposedBy: 1, createdAt: -1 });

const PaymentConfigProposal = mongoose.model("PaymentConfigProposal", paymentConfigProposalSchema, "paymentconfigproposals");

module.exports = PaymentConfigProposal;
module.exports.proposalStatuses = proposalStatuses;
