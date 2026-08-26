const mongoose = require("mongoose");
const PaymentIntent = require("../../models/PaymentIntent");
const PaymentAuditLog = require("../../models/PaymentAuditLog");
const paymentLifecycleService = require("./paymentLifecycleService");
const paymentSettlementService = require("./paymentSettlementService");
const { badRequest, conflict, notFound } = require("../../utils/errors");

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const REVIEW_NOTE_MAX_LENGTH = 1000;
const reviewActions = new Set([
    "MARK_REVIEWED",
    "MARK_UNDERPAYMENT_ACKNOWLEDGED",
    "MARK_PAID_UNCREDITED_REVIEWED",
    "ADD_ADMIN_NOTE"
]);

const retryableFailureCodes = new Set([
    "PAYMENT_TRANSACTION_NOT_FOUND",
    "PAYMENT_RECEIPT_NOT_FOUND",
    "PAYMENT_PROVIDER_FAILURE",
    "PAYMENT_CONFIRMING",
    "PAYMENT_INVALID_RECEIPT"
]);

const clampLimit = (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT;
    return Math.min(parsed, MAX_LIMIT);
};

const normalizeNote = (note) => {
    if (typeof note !== "string") {
        throw badRequest("INVALID_REVIEW_NOTE", "Review note is required");
    }

    const trimmed = note.trim();
    if (!trimmed) {
        throw badRequest("INVALID_REVIEW_NOTE", "Review note is required");
    }

    if (trimmed.length > REVIEW_NOTE_MAX_LENGTH) {
        throw badRequest("INVALID_REVIEW_NOTE", "Review note is too long");
    }

    return trimmed;
};

const normalizeReviewAction = (action) => {
    const normalized = typeof action === "string" ? action.trim().toUpperCase() : "MARK_REVIEWED";
    if (!reviewActions.has(normalized)) {
        throw badRequest("INVALID_REVIEW_ACTION", "Invalid review action");
    }
    return normalized;
};

const reviewStatusForAction = (action) => {
    if (action === "MARK_UNDERPAYMENT_ACKNOWLEDGED") return "UNDERPAYMENT_ACKNOWLEDGED";
    if (action === "MARK_PAID_UNCREDITED_REVIEWED") return "PAID_UNCREDITED_REVIEWED";
    if (action === "ADD_ADMIN_NOTE") return "NOTE_ADDED";
    return "REVIEWED";
};

const encodeCursor = (doc) => {
    if (!doc?.createdAt || !doc?._id) return null;
    return Buffer.from(JSON.stringify({
        createdAt: new Date(doc.createdAt).toISOString(),
        id: String(doc._id)
    }), "utf8").toString("base64url");
};

const decodeCursor = (cursor) => {
    if (!cursor || typeof cursor !== "string") return null;

    try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        const createdAt = new Date(parsed.createdAt);
        if (Number.isNaN(createdAt.getTime()) || !mongoose.Types.ObjectId.isValid(parsed.id)) return null;
        return { createdAt, id: new mongoose.Types.ObjectId(parsed.id) };
    } catch {
        return null;
    }
};

const cursorFilter = (cursor) => {
    const decoded = decodeCursor(cursor);
    if (!decoded) return {};

    return {
        $or: [
            { createdAt: { $lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, _id: { $lt: decoded.id } }
        ]
    };
};

const hasTransactionIdentifier = (intent) => Boolean(intent.txHash || intent.transactionSignature || intent.candidateTxHash);

const candidateReason = (intent) => {
    if (["MANUAL_REVIEW_REQUIRED", "UNDERPAID"].includes(intent.status)) return "MANUAL_REVIEW";
    if (["CONFIRMED", "CONFIRMED_OVERPAID"].includes(intent.status) && !intent.creditedTransactionId) return "PAID_UNCREDITED";
    if (hasTransactionIdentifier(intent) && !intent.creditedTransactionId && ["SUBMITTED", "CONFIRMING"].includes(intent.status)) return "VERIFY_RETRY";
    if (hasTransactionIdentifier(intent) && !intent.creditedTransactionId && ["FAILED", "REJECTED"].includes(intent.status) && retryableFailureCodes.has(intent.failureCode)) return "PROVIDER_RETRY";
    return "REVIEW";
};

const candidateFilter = ({ status, methodId, reviewStatus, cursor } = {}) => {
    const filter = {
        $and: [
            {
                $or: [
            { status: { $in: ["MANUAL_REVIEW_REQUIRED", "UNDERPAID"] } },
            { status: { $in: ["CONFIRMED", "CONFIRMED_OVERPAID"] }, creditedTransactionId: null },
            { status: { $in: ["SUBMITTED", "CONFIRMING"] }, creditedTransactionId: null, $or: [{ txHash: { $type: "string" } }, { transactionSignature: { $type: "string" } }, { candidateTxHash: { $type: "string" } }] },
            { status: { $in: ["FAILED", "REJECTED"] }, creditedTransactionId: null, failureCode: { $in: [...retryableFailureCodes] }, $or: [{ txHash: { $type: "string" } }, { transactionSignature: { $type: "string" } }, { candidateTxHash: { $type: "string" } }] }
                ]
            }
        ]
    };
    const cursorQuery = cursorFilter(cursor);
    if (Object.keys(cursorQuery).length > 0) filter.$and.push(cursorQuery);

    if (status) filter.status = status;
    if (methodId && /^[A-Za-z0-9_-]{1,80}$/.test(methodId)) filter.paymentMethodId = methodId;
    if (reviewStatus && /^[A-Z_]{1,64}$/.test(reviewStatus)) filter.reviewStatus = reviewStatus;
    return filter;
};

const safeErrorMetadata = (error) => ({
    errorCode: error?.code || "PAYMENT_RECONCILIATION_ERROR",
    errorStatus: error?.status || 500
});

const createPaymentReconciliationService = ({
    PaymentIntentModel = PaymentIntent,
    PaymentAuditLogModel = PaymentAuditLog,
    lifecycleService = paymentLifecycleService,
    settlementService = paymentSettlementService,
    now = () => new Date()
} = {}) => {
    const appendAuditLog = async ({
        paymentIntentId,
        actorUserId,
        action,
        statusBefore,
        statusAfter,
        note = null,
        metadata = undefined
    }, { session } = {}) => {
        const entry = {
            paymentIntentId,
            actorUserId,
            action,
            statusBefore: statusBefore || null,
            statusAfter: statusAfter || null,
            note,
            metadata
        };
        const options = session ? { session } : undefined;
        const [audit] = await PaymentAuditLogModel.create([entry], options);
        return audit;
    };

    const listCandidates = async ({ status, methodId, reviewStatus, limit, cursor } = {}) => {
        const requestedLimit = clampLimit(limit);
        const docs = await PaymentIntentModel.find(candidateFilter({ status, methodId, reviewStatus, cursor }))
            .sort({ createdAt: -1, _id: -1 })
            .limit(requestedLimit + 1)
            .lean();
        const items = docs.slice(0, requestedLimit);
        const auditLogs = items.length > 0
            ? await PaymentAuditLogModel.find({ paymentIntentId: { $in: items.map(item => item._id) } })
                .sort({ createdAt: -1, _id: -1 })
                .lean()
            : [];
        const latestAuditByIntent = new Map();

        auditLogs.forEach((audit) => {
            const key = String(audit.paymentIntentId);
            if (!latestAuditByIntent.has(key)) latestAuditByIntent.set(key, audit);
        });

        return {
            items: items.map(intent => ({
                intent,
                reason: candidateReason(intent),
                latestAudit: latestAuditByIntent.get(String(intent._id)) || null
            })),
            nextCursor: docs.length > requestedLimit ? encodeCursor(items[items.length - 1]) : null,
            limit: requestedLimit
        };
    };

    const retryVerify = async ({ paymentIntentId, actorUserId }) => {
        const intent = await PaymentIntentModel.findById(paymentIntentId);
        if (!intent) {
            throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
        }

        const txIdentifier = intent.txHash || intent.transactionSignature || intent.candidateTxHash;
        if (!txIdentifier) {
            throw conflict("PAYMENT_RETRY_UNAVAILABLE", "Payment intent has no transaction identifier to verify");
        }

        const statusBefore = intent.status;
        try {
            const result = await lifecycleService.verifyIntent({
                userId: intent.userId,
                paymentIntentId: intent._id,
                txHash: txIdentifier
            });
            await appendAuditLog({
                paymentIntentId: intent._id,
                actorUserId,
                action: "RETRY_VERIFY",
                statusBefore,
                statusAfter: result.intent?.status || statusBefore,
                metadata: {
                    outcome: "SUCCESS",
                    settlementCreated: Boolean(result.settlement?.created),
                    settled: Boolean(result.settlement?.settled)
                }
            });
            return result;
        } catch (error) {
            await appendAuditLog({
                paymentIntentId: intent._id,
                actorUserId,
                action: "RETRY_VERIFY",
                statusBefore,
                statusAfter: statusBefore,
                metadata: {
                    outcome: "ERROR",
                    ...safeErrorMetadata(error)
                }
            });
            throw error;
        }
    };

    const retrySettlement = async ({ paymentIntentId, actorUserId }) => {
        const intent = await PaymentIntentModel.findById(paymentIntentId);
        if (!intent) {
            throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
        }

        const statusBefore = intent.status;
        const settlement = await settlementService.settlePaymentIntent({
            paymentIntentId: intent._id,
            userId: intent.userId
        });
        const updatedIntent = await PaymentIntentModel.findById(intent._id);
        await appendAuditLog({
            paymentIntentId: intent._id,
            actorUserId,
            action: "RETRY_VERIFY",
            statusBefore,
            statusAfter: updatedIntent?.status || statusBefore,
            metadata: {
                outcome: "SETTLEMENT_RETRY",
                settlementCreated: Boolean(settlement?.created),
                settled: Boolean(settlement?.settled)
            }
        });

        return { intent: updatedIntent || intent, settlement };
    };

    const retryVerificationOrSettlement = async ({ paymentIntentId, actorUserId }) => {
        const intent = await PaymentIntentModel.findById(paymentIntentId);
        if (!intent) {
            throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
        }

        if (["CONFIRMED", "CONFIRMED_OVERPAID"].includes(intent.status) && !intent.creditedTransactionId) {
            return retrySettlement({ paymentIntentId, actorUserId });
        }

        return retryVerify({ paymentIntentId, actorUserId });
    };

    const markReviewed = async ({ paymentIntentId, actorUserId, action, note }) => {
        const reviewAction = normalizeReviewAction(action);
        const reviewNote = normalizeNote(note);
        const intent = await PaymentIntentModel.findById(paymentIntentId);
        if (!intent) {
            throw notFound("PAYMENT_INTENT_NOT_FOUND", "Payment intent was not found");
        }

        const statusBefore = intent.status;
        const reviewStatus = reviewStatusForAction(reviewAction);
        const reviewedAt = now();
        const updatedIntent = await PaymentIntentModel.findOneAndUpdate(
            { _id: intent._id },
            {
                $set: {
                    reviewStatus,
                    reviewedAt,
                    reviewedBy: actorUserId,
                    reviewNote: reviewNote.slice(0, 280)
                }
            },
            { new: true }
        );

        const audit = await appendAuditLog({
            paymentIntentId: intent._id,
            actorUserId,
            action: reviewAction,
            statusBefore,
            statusAfter: updatedIntent?.status || statusBefore,
            note: reviewNote,
            metadata: {
                reviewStatus
            }
        });

        return { intent: updatedIntent || intent, audit };
    };

    return {
        appendAuditLog,
        listCandidates,
        markReviewed,
        retryVerificationOrSettlement
    };
};

module.exports = createPaymentReconciliationService();
module.exports.createPaymentReconciliationService = createPaymentReconciliationService;
module.exports.candidateReason = candidateReason;
module.exports.normalizeNote = normalizeNote;
