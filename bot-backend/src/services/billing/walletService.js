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
const idsEqual = (left, right) => String(left || "") === String(right || "");

const assertReservationMatches = (reservation, { userId, amount, referenceType, referenceId }) => {
    if (!reservation || reservation.type !== "RESERVATION") {
        throw conflict("AI_RESERVATION_NOT_FOUND", "AI operation reservation was not found");
    }

    if (
        !idsEqual(reservation.userId, userId) ||
        reservation.amount !== amount ||
        reservation.referenceType !== referenceType ||
        reservation.referenceId !== referenceId
    ) {
        throw conflict("AI_RESERVATION_MISMATCH", "AI operation reservation does not match the settlement request");
    }
};

const assertSettlementMatches = (settlement, reservationKey) => {
    if (settlement && settlement.reservationKey !== reservationKey) {
        throw conflict("AI_RESERVATION_MISMATCH", "AI operation settlement does not match the reservation");
    }
};

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

    const getWallet = async ({ userId }) => getOrCreateWallet(userId);

    const getAvailableCredits = async ({ userId }) => {
        const wallet = await getOrCreateWallet(userId);
        return Math.max((wallet.balance || 0) - (wallet.reserved || 0), 0);
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
                assertReservationMatches(existing, { userId, amount, referenceType, referenceId });
                const wallet = await getOrCreateWallet(userId, { session });
                const settlement = await ledgerService.findReservationSettlement(idempotencyKey, { session });
                return {
                    wallet,
                    transaction: existing,
                    settlement,
                    created: false,
                    settled: Boolean(settlement)
                };
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
                reservationKey: idempotencyKey,
                metadata
            }, { session });

            if (!ledger.created) {
                throw conflict("AI_OPERATION_ALREADY_RESERVED", "AI operation reservation already exists");
            }

            const wallet = await addSession(WalletModel.findOne({ userId }), session);
            return { wallet, transaction: ledger.transaction, settlement: null, created: true, settled: false };
        });
    };

    const finalizeCharge = async ({ userId, reservationKey, reservedAmount, actualAmount, debitKey, releaseKey, referenceType, referenceId, metadata }) => {
        assertPositiveInteger(reservedAmount);
        if (!Number.isInteger(actualAmount) || actualAmount < 0) {
            throw accountingError("ACCOUNTING_INVALID_AMOUNT", "Actual charge must be a non-negative integer");
        }
        if (actualAmount > reservedAmount) {
            throw accountingError("ACCOUNTING_ESTIMATE_EXCEEDED", "Actual charge exceeded reserved credits");
        }

        return withTransaction(async (session) => {
            const reservation = await ledgerService.findByIdempotencyKey(reservationKey, { session });
            assertReservationMatches(reservation, { userId, amount: reservedAmount, referenceType, referenceId });

            const existingDebit = await ledgerService.findByIdempotencyKey(debitKey, { session });
            if (existingDebit) {
                assertSettlementMatches(existingDebit, reservationKey);
                const wallet = await getOrCreateWallet(userId, { session });
                return {
                    wallet,
                    reservation,
                    debit: existingDebit,
                    release: releaseKey ? await ledgerService.findByIdempotencyKey(releaseKey, { session }) : null,
                    created: false
                };
            }

            const existingSettlement = await ledgerService.findReservationSettlement(reservationKey, { session });
            if (existingSettlement) {
                throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation reservation has already been settled");
            }

            const before = await addSession(WalletModel.findOneAndUpdate(
                {
                    userId,
                    reserved: { $gte: reservedAmount },
                    balance: { $gte: actualAmount },
                    $expr: { $gte: ["$balance", "$reserved"] }
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

            const debit = await ledgerService.recordTransaction({
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
                reservationKey,
                idempotencyKey: debitKey,
                metadata
            }, { session });

            const unused = reservedAmount - actualAmount;
            const release = await ledgerService.recordTransaction({
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
                reservationKey,
                idempotencyKey: releaseKey,
                metadata: { ...metadata, reason: "unused-reservation" }
            }, { session });

            const wallet = await addSession(WalletModel.findOne({ userId }), session);
            return { wallet, reservation, debit: debit.transaction, release: release.transaction, created: true };
        });
    };

    const releaseReservation = async ({ userId, reservationKey, amount, idempotencyKey, referenceType, referenceId, metadata }) => {
        assertPositiveInteger(amount);

        return withTransaction(async (session) => {
            const reservation = await ledgerService.findByIdempotencyKey(reservationKey, { session });
            assertReservationMatches(reservation, { userId, amount, referenceType, referenceId });

            const existing = await ledgerService.findByIdempotencyKey(idempotencyKey, { session });
            if (existing) {
                assertSettlementMatches(existing, reservationKey);
                const wallet = await getOrCreateWallet(userId, { session });
                return { wallet, reservation, transaction: existing, created: false };
            }

            const existingSettlement = await ledgerService.findReservationSettlement(reservationKey, { session });
            if (existingSettlement) {
                throw conflict("AI_OPERATION_ALREADY_FINALIZED", "AI operation reservation has already been settled");
            }

            const before = await addSession(WalletModel.findOneAndUpdate(
                {
                    userId,
                    reserved: { $gte: amount },
                    $expr: { $gte: ["$balance", "$reserved"] }
                },
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
                reservationKey,
                idempotencyKey,
                metadata
            }, { session });

            const wallet = await addSession(WalletModel.findOne({ userId }), session);
            return { wallet, reservation, transaction: ledger.transaction, created: ledger.created };
        });
    };

    return {
        finalizeCharge,
        getAvailableCredits,
        getWallet,
        getOrCreateWallet,
        grantDevelopmentCredits,
        releaseReservation,
        reserveCredits
    };
};

module.exports = createWalletService();
module.exports.createWalletService = createWalletService;
