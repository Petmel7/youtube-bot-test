const mongoose = require("mongoose");

const actionValues = [
    "CREATE_PROPOSAL",
    "CONFIRM_PROPOSAL",
    "APPROVE_PROPOSAL",
    "ACTIVATE_PROPOSAL",
    "REJECT_PROPOSAL",
    "CANCEL_PROPOSAL"
];

const paymentConfigAuditLogSchema = new mongoose.Schema({
    proposalId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentConfigProposal", required: true, index: true, immutable: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
    action: { type: String, enum: actionValues, required: true, immutable: true },
    statusBefore: { type: String, default: null, immutable: true },
    statusAfter: { type: String, default: null, immutable: true },
    reason: { type: String, default: null, maxlength: 1000, immutable: true },
    note: { type: String, default: null, maxlength: 1000, immutable: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined, immutable: true }
}, {
    strict: true,
    timestamps: { createdAt: true, updatedAt: false }
});

paymentConfigAuditLogSchema.index({ action: 1, createdAt: -1 });

const PaymentConfigAuditLog = mongoose.model("PaymentConfigAuditLog", paymentConfigAuditLogSchema, "paymentconfigauditlogs");

module.exports = PaymentConfigAuditLog;
module.exports.paymentConfigAuditActions = actionValues;
