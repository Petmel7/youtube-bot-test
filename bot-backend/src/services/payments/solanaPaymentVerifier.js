const { getAllowedPaymentMethod } = require("../../config/paymentNetworks");
const { getPaymentMethodById } = require("../../config/paymentMethods");
const { paymentConfig } = require("../../config/config");
const { isValidSolanaSignature } = require("../../utils/solana");
const { createSolanaProvider } = require("./solanaProvider");
const {
    PAYMENT_OUTCOMES,
    PAYMENT_VERIFICATION_CODES,
    createPaymentResult
} = require("./paymentVerifier");

const canonicalDecimalStringPattern = /^(0|[1-9][0-9]*)$/;

const isValidExpectedAmount = (value) => (
    typeof value === "string" &&
    canonicalDecimalStringPattern.test(value) &&
    BigInt(value) > 0n
);

const createSolanaPaymentVerifier = ({
    provider = null,
    config = paymentConfig,
    providerFactory = (method) => createSolanaProvider({ rpcUrl: method.rpcUrl })
} = {}) => {
    const verifyPaymentIntent = async (paymentIntent) => {
        const txHash = paymentIntent?.txHash;
        const context = { intent: paymentIntent, config, txHash };

        if (!isValidSolanaSignature(txHash || "")) {
            return createPaymentResult({
                ...context,
                outcome: PAYMENT_OUTCOMES.REJECTED,
                code: PAYMENT_VERIFICATION_CODES.INVALID_TX_HASH
            });
        }

        try {
            const method = paymentIntent.paymentMethodSnapshot || null;
            const allowedMethod = method?.id ? getAllowedPaymentMethod(method.id) : null;

            if (!method || !allowedMethod || paymentIntent.paymentMethodId !== method.id || method.namespace !== "solana") {
                return createPaymentResult({ ...context, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.WRONG_METHOD });
            }

            if (
                paymentIntent.namespace !== "solana" ||
                paymentIntent.networkId !== method.networkId ||
                method.networkId !== allowedMethod.networkId ||
                method.network !== allowedMethod.network ||
                method.cluster !== allowedMethod.cluster
            ) {
                return createPaymentResult({ ...context, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.WRONG_NETWORK });
            }

            if (
                paymentIntent.mintAddress !== method.mintAddress ||
                method.mintAddress !== allowedMethod.mintAddress ||
                paymentIntent.tokenSymbol !== method.tokenSymbol ||
                paymentIntent.tokenDecimals !== method.tokenDecimals ||
                method.assetType !== "spl-token"
            ) {
                return createPaymentResult({ ...context, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.WRONG_TOKEN });
            }

            if (paymentIntent.recipientAddress !== method.treasuryAddress) {
                return createPaymentResult({ ...context, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.WRONG_RECIPIENT });
            }

            if (!isValidExpectedAmount(paymentIntent.expectedTokenAmountBaseUnits)) {
                return createPaymentResult({ ...context, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.INVALID_AMOUNT });
            }

            const runtimeMethod = getPaymentMethodById(config, method.id) || method;
            const verifierProvider = provider || providerFactory(runtimeMethod);
            const genesisHash = await verifierProvider.getGenesisHash();
            if (genesisHash !== method.networkId) {
                return createPaymentResult({ ...context, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.WRONG_NETWORK });
            }

            const signatureStatus = await verifierProvider.getSignatureStatus(txHash);
            if (!signatureStatus) {
                return createPaymentResult({
                    ...context,
                    outcome: PAYMENT_OUTCOMES.PENDING,
                    code: PAYMENT_VERIFICATION_CODES.TX_NOT_FOUND,
                    retryable: true
                });
            }

            if (signatureStatus.err) {
                return createPaymentResult({
                    ...context,
                    outcome: PAYMENT_OUTCOMES.REJECTED,
                    code: PAYMENT_VERIFICATION_CODES.TX_REVERTED,
                    transactionStatus: "FAILED"
                });
            }

            const transaction = await verifierProvider.getParsedTransaction(txHash);
            if (!transaction) {
                return createPaymentResult({
                    ...context,
                    outcome: PAYMENT_OUTCOMES.PENDING,
                    code: PAYMENT_VERIFICATION_CODES.RECEIPT_NOT_FOUND,
                    retryable: true
                });
            }

            const slot = transaction.slot ?? signatureStatus.slot ?? null;
            const confirmationCount = signatureStatus.confirmations ?? (signatureStatus.confirmationStatus === "finalized" ? method.confirmations : 0);
            const statusContext = {
                ...context,
                firstSeenBlock: slot,
                confirmedBlock: slot,
                confirmationCount,
                transactionStatus: "SUCCESS"
            };

            const transfer = verifierProvider.findTokenTransfer(transaction, {
                mintAddress: method.mintAddress,
                sourceOwner: paymentIntent.payerAddress,
                destinationOwner: method.treasuryAddress
            });

            if (transfer?.ambiguous) {
                return createPaymentResult({ ...statusContext, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.TRANSFER_AMBIGUOUS });
            }

            if (!transfer) {
                return createPaymentResult({ ...statusContext, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.TRANSFER_NOT_FOUND });
            }

            const verifiedTokenAmountBaseUnits = transfer.value.toString();
            const transferContext = {
                ...statusContext,
                fromAddress: transfer.from,
                verifiedTokenAmountBaseUnits
            };

            if (transfer.from !== paymentIntent.payerAddress) {
                return createPaymentResult({ ...transferContext, outcome: PAYMENT_OUTCOMES.REJECTED, code: PAYMENT_VERIFICATION_CODES.WRONG_PAYER });
            }

            if (confirmationCount < method.confirmations || signatureStatus.confirmationStatus !== "finalized") {
                return createPaymentResult({
                    ...transferContext,
                    outcome: PAYMENT_OUTCOMES.CONFIRMING,
                    code: PAYMENT_VERIFICATION_CODES.CONFIRMING,
                    retryable: true
                });
            }

            const expectedAmount = BigInt(paymentIntent.expectedTokenAmountBaseUnits);
            if (transfer.value < expectedAmount) {
                return createPaymentResult({ ...transferContext, outcome: PAYMENT_OUTCOMES.UNDERPAID, code: PAYMENT_VERIFICATION_CODES.UNDERPAID });
            }

            if (transfer.value > expectedAmount) {
                return createPaymentResult({ ...transferContext, outcome: PAYMENT_OUTCOMES.OVERPAID, code: PAYMENT_VERIFICATION_CODES.OVERPAID });
            }

            return createPaymentResult({ ...transferContext, outcome: PAYMENT_OUTCOMES.VERIFIED, code: PAYMENT_VERIFICATION_CODES.VERIFIED });
        } catch {
            return createPaymentResult({
                ...context,
                outcome: PAYMENT_OUTCOMES.REJECTED,
                code: PAYMENT_VERIFICATION_CODES.PROVIDER_FAILURE,
                retryable: true
            });
        }
    };

    return { verifyPaymentIntent };
};

module.exports = {
    createSolanaPaymentVerifier
};
