const WalletTransaction = require("../../models/WalletTransaction");

const createLedgerService = ({ TransactionModel = WalletTransaction } = {}) => {
    const findByIdempotencyKey = async (idempotencyKey, { session } = {}) => {
        const query = TransactionModel.findOne({ idempotencyKey });
        return session ? query.session(session) : query;
    };

    const findReservationSettlement = async (reservationKey, { session } = {}) => {
        const query = TransactionModel.findOne({
            reservationKey,
            type: { $in: ["DEBIT", "RELEASE"] }
        });
        return session ? query.session(session) : query;
    };

    const recordTransaction = async (entry, { session } = {}) => {
        const existing = await findByIdempotencyKey(entry.idempotencyKey, { session });
        if (existing) {
            return { transaction: existing, created: false };
        }

        const createOptions = session ? { session } : undefined;
        const docs = await TransactionModel.create([entry], createOptions);
        return { transaction: docs[0], created: true };
    };

    return { findByIdempotencyKey, findReservationSettlement, recordTransaction };
};

module.exports = createLedgerService();
module.exports.createLedgerService = createLedgerService;
