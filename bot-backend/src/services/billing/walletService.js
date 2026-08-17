const mongoose = require("mongoose");
const Wallet = require("../../models/Wallet");
const { paymentRequired, conflict, accountingError } = require("../../utils/errors");
const { aiCreditUnit } = require("../../config/config");
const { createLedgerService } = require("./ledgerService");

const assertPositiveInteger = (amount) => {
    if (!Number.isInteger(amount) || amount <= 0) {
        throw accountingError("ACCOUNTING_INVALID_AMOUNT", "Credit amount must be a positive integer");
    }
};

const addSession = (query, session) => session ? query.session(session) : query;

const createWalletService = ({
    WalletModel = Wallet,
    ledgerService = createLedgerService(),
    withTransaction = (callback) => mongoose.connection.transaction(callback)
} = {}) => {
    const getOrCreateWallet = async (userId, { session } = {}) => {
        const query = WalletModel.findOneAndUpdate(
            { userId },
            { $setOnInsert: { userId, balance: 0, reserved: 0, unit: aiCreditUnit } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        return addSession(query, session);
    };

    const grantDevelopmentCredits = async ({ userId, amount, idempotencyKey, reason = "development-credit" }) => {
        assertPositiveInteger(amount);

        return withTransaction(async (session) => {
            const existing = await ledgerService.findByIdempotencyKey(idempotencyKey, { session });

            if (existing) {
                const wallet = await getOrCreateWallet(userId, { session });
                return { wallet, transaction: existing, created: false };
            }

            const before = await addSession(WalletModel.findOneAndUpdate(
                { userId },
                {
                    $setOnInsert: { userId, balance: 0, reserved: 0, unit: aiCreditUnit },
                    $inc: { balance: amount }
                },
                { upsert: true, new: false, setDefaultsOnInsert: true }
            ), session);
            const wallet = await addSession(WalletModel.findOne({ userId }), session);
            const ledger = await ledgerService.recordTransaction({
                userId,
                walletId: wallet._id,
                type: "CREDIT",
                amount,
                balanceBefore: before?.balance || 0,
                balanceAfter: wallet.balance,
                reservedBefore: before?.reserved || 0,
                reservedAfter: wallet.reserved,
                referenceType: "development",
                referenceId: reason,
                idempotencyKey,
                metadata: { reason }
            }, { session });

            return { wallet, transaction: ledger.transaction, created: ledger.created };
        });
    };

    const reserveCredits = async ({ userId, amount, idempotencyKey, referenceType, referenceId, metadata }) => {
        assertPositiveInteger(amount);

        return withTransaction(async (session) => {
            const existing = await ledgerService.findByIdempotencyKey(idempotencyKey, { session });
            if (existing) {
                const wallet = await getOrCreateWallet(userId, { session });
                return { wallet, transaction: existing, created: false };
            }

            await getOrCreateWallet(userId, { session });

            const before = await addSession(WalletModel.findOneAndUpdate(
                {
                    userId,
                    $expr: { $gte: [{ $subtract: ["$balance", "$reserved"] }, amount] }
                },
                { $inc: { reserved: amount } },
                { new: false }
            ), session);

            if (!before) {
                throw paymentRequired("INSUFFICIENT_CREDITS", "Insufficient credits");
            }

            const after = {
                balance: before.balance,
                reserved: before.reserved + amount
            };

            const ledger = await ledgerService.recordTransaction({
                userId,
                walletId: before._id,
                type: "RESERVATION",
                amount,
                balanceBefore: before.balance,
                balanceAfter: after.balance,
                reservedBefore: before.reserved,
                reservedAfter: after.reserved,
                referenceType,
                referenceId,
                idempotencyKey,
                metadata
            }, { session });

            if (!ledger.created) {
                throw conflict("AI_OPERATION_ALREADY_RESERVED", "AI operation reservation already exists");
            }

            const wallet = await addSession(WalletModel.findOne({ userId }), session);
            return { wallet, transaction: ledger.transaction, created: true };
        });
    };

    const finalizeCharge = async ({ userId, reservedAmount, actualAmount, debitKey, releaseKey, referenceType, referenceId, metadata }) => {
        assertPositiveInteger(reservedAmount);
        if (!Number.isInteger(actualAmount) || actualAmount < 0) {
            throw accountingError("ACCOUNTING_INVALID_AMOUNT", "Actual charge must be a non-negative integer");
        }
        if (actualAmount > reservedAmount) {
            throw accountingError("ACCOUNTING_ESTIMATE_EXCEEDED", "Actual charge exceeded reserved credits");
        }

        return withTransaction(async (session) => {
            const existingDebit = await ledgerService.findByIdempotencyKey(debitKey, { session });
            if (existingDebit) {
                const wallet = await getOrCreateWallet(userId, { session });
                return { wallet, debit: existingDebit, release: releaseKey ? await ledgerService.findByIdempotencyKey(releaseKey, { session }) : null, created: false };
            }

            const before = await addSession(WalletModel.findOneAndUpdate(
                {
                    userId,
                    reserved: { $gte: reservedAmount },
                    balance: { $gte: actualAmount }
                },
                { $inc: { balance: -actualAmount, reserved: -reservedAmount } },
                { new: false }
            ), session);

            if (!before) {
                throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation cannot be finalized");
            }

            const after = {
                balance: before.balance - actualAmount,
                reserved: before.reserved - reservedAmount
            };

            const debit = actualAmount > 0
                ? await ledgerService.recordTransaction({
                    userId,
                    walletId: before._id,
                    type: "DEBIT",
                    amount: actualAmount,
                    balanceBefore: before.balance,
                    balanceAfter: after.balance,
                    reservedBefore: before.reserved,
                    reservedAfter: after.reserved,
                    referenceType,
                    referenceId,
                    idempotencyKey: debitKey,
                    metadata
                }, { session })
                : null;

            const unused = reservedAmount - actualAmount;
            const release = unused > 0
                ? await ledgerService.recordTransaction({
                    userId,
                    walletId: before._id,
                    type: "RELEASE",
                    amount: unused,
                    balanceBefore: after.balance,
                    balanceAfter: after.balance,
                    reservedBefore: before.reserved,
                    reservedAfter: after.reserved,
                    referenceType,
                    referenceId,
                    idempotencyKey: releaseKey,
                    metadata: { ...metadata, reason: "unused-reservation" }
                }, { session })
                : null;

            const wallet = await addSession(WalletModel.findOne({ userId }), session);
            return { wallet, debit: debit?.transaction || null, release: release?.transaction || null };
        });
    };

    const releaseReservation = async ({ userId, amount, idempotencyKey, referenceType, referenceId, metadata }) => {
        assertPositiveInteger(amount);

        return withTransaction(async (session) => {
            const existing = await ledgerService.findByIdempotencyKey(idempotencyKey, { session });
            if (existing) {
                const wallet = await getOrCreateWallet(userId, { session });
                return { wallet, transaction: existing, created: false };
            }

            const before = await addSession(WalletModel.findOneAndUpdate(
                { userId, reserved: { $gte: amount } },
                { $inc: { reserved: -amount } },
                { new: false }
            ), session);

            if (!before) {
                throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation reservation cannot be released");
            }

            const after = {
                balance: before.balance,
                reserved: before.reserved - amount
            };

            const ledger = await ledgerService.recordTransaction({
                userId,
                walletId: before._id,
                type: "RELEASE",
                amount,
                balanceBefore: before.balance,
                balanceAfter: after.balance,
                reservedBefore: before.reserved,
                reservedAfter: after.reserved,
                referenceType,
                referenceId,
                idempotencyKey,
                metadata
            }, { session });

            const wallet = await addSession(WalletModel.findOne({ userId }), session);
            return { wallet, transaction: ledger.transaction, created: ledger.created };
        });
    };

    return {
        finalizeCharge,
        getOrCreateWallet,
        grantDevelopmentCredits,
        releaseReservation,
        reserveCredits
    };
};

module.exports = createWalletService();
module.exports.createWalletService = createWalletService;
