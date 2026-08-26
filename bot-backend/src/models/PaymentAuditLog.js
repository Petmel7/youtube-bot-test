const mongoose = require("mongoose");

const actionValues = [
    "RETRY_VERIFY",
    "MARK_REVIEWED",
    "MARK_UNDERPAYMENT_ACKNOWLEDGED",
    "MARK_PAID_UNCREDITED_REVIEWED",
    "ADD_ADMIN_NOTE"
];

const paymentAuditLogSchema = new mongoose.Schema({
    paymentIntentId: { type: mongoose.Schema.Types.ObjectId, ref: "PaymentIntent", required: true, index: true, immutable: true },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true, immutable: true },
    action: { type: String, enum: actionValues, required: true, immutable: true },
    statusBefore: { type: String, default: null, immutable: true },
    statusAfter: { type: String, default: null, immutable: true },
    note: { type: String, default: null, maxlength: 1000, immutable: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: undefined, immutable: true }
}, {
    strict: true,
    timestamps: { createdAt: true, updatedAt: false }
});

paymentAuditLogSchema.index({ paymentIntentId: 1, createdAt: -1 });
paymentAuditLogSchema.index({ action: 1, createdAt: -1 });

const PaymentAuditLog = mongoose.model("PaymentAuditLog", paymentAuditLogSchema, "paymentauditlogs");

module.exports = PaymentAuditLog;
module.exports.paymentAuditActions = actionValues;
