const { paymentConfig } = require("../../config/config");
const { getAllowedPaymentMethod } = require("../../config/paymentNetworks");
const { normalizeEvmAddress } = require("../../utils/evmAddress");
const { createEvmProvider } = require("./evmProvider");

const PAYMENT_OUTCOMES = Object.freeze({
    PENDING: "PENDING",
    CONFIRMING: "CONFIRMING",
    VERIFIED: "VERIFIED",
    UNDERPAID: "UNDERPAID",
    OVERPAID: "OVERPAID",
    REJECTED: "REJECTED"
});

const PAYMENT_VERIFICATION_CODES = Object.freeze({
    INVALID_TX_HASH: "PAYMENT_INVALID_TX_HASH",
    WRONG_NETWORK: "PAYMENT_WRONG_NETWORK",
    WRONG_METHOD: "PAYMENT_WRONG_METHOD",
    TX_NOT_FOUND: "PAYMENT_TRANSACTION_NOT_FOUND",
    RECEIPT_NOT_FOUND: "PAYMENT_RECEIPT_NOT_FOUND",
    TX_REVERTED: "PAYMENT_TRANSACTION_REVERTED",
    WRONG_TOKEN: "PAYMENT_WRONG_TOKEN",
    WRONG_PAYER: "PAYMENT_WRONG_PAYER",
    TRANSFER_NOT_FOUND: "PAYMENT_TRANSFER_NOT_FOUND",
    TRANSFER_AMBIGUOUS: "PAYMENT_TRANSFER_AMBIGUOUS",
    WRONG_RECIPIENT: "PAYMENT_WRONG_RECIPIENT",
    INVALID_RECEIPT: "PAYMENT_INVALID_RECEIPT",
    INVALID_AMOUNT: "PAYMENT_INVALID_AMOUNT",
    UNDERPAID: "PAYMENT_UNDERPAID",
    OVERPAID: "PAYMENT_OVERPAID",
    CONFIRMING: "PAYMENT_CONFIRMING",
    VERIFIED: "PAYMENT_VERIFIED",
    PROVIDER_FAILURE: "PAYMENT_PROVIDER_FAILURE"
});

const canonicalTxHashPattern = /^0x[a-f0-9]{64}$/;
const canonicalDecimalStringPattern = /^(0|[1-9][0-9]*)$/;

const createResult = ({
    outcome,
    code,
    retryable = false,
    intent,
    config,
    txHash,
    fromAddress = null,
    verifiedTokenAmountBaseUnits = null,
    firstSeenBlock = null,
    confirmedBlock = null,
    confirmationCount = null,
    transactionStatus = null
}) => ({
    outcome,
    code,
    retryable,
    chainId: intent?.chainId ?? intent?.paymentMethodSnapshot?.chainId ?? config.chainId,
    txHash: txHash || intent?.txHash || null,
    tokenAddress: intent?.tokenAddress || intent?.paymentMethodSnapshot?.tokenAddress || config.tokenAddress,
    tokenDecimals: intent?.tokenDecimals ?? intent?.paymentMethodSnapshot?.tokenDecimals ?? config.tokenDecimals,
    recipientAddress: intent?.recipientAddress || intent?.paymentMethodSnapshot?.treasuryAddress || config.treasuryAddress,
    payerAddress: intent?.payerAddress || null,
    fromAddress,
    verifiedTokenAmountBaseUnits,
    expectedTokenAmountBaseUnits: intent?.expectedTokenAmountBaseUnits || null,
    firstSeenBlock,
    confirmedBlock,
    confirmationCount,
    transactionStatus
});

const rejectResult = (code, context) => createResult({
    ...context,
    outcome: PAYMENT_OUTCOMES.REJECTED,
    code
});

const pendingResult = (code, context) => createResult({
    ...context,
    outcome: PAYMENT_OUTCOMES.PENDING,
    code,
    retryable: true
});

const isValidExpectedAmount = (value) => (
    typeof value === "string" &&
    canonicalDecimalStringPattern.test(value) &&
    BigInt(value) > 0n
);

const createPaymentVerifier = ({
    provider = null,
    config = paymentConfig,
    providerFactory = (method) => createEvmProvider({ rpcUrl: method.rpcUrl })
} = {}) => {
    const verifyPaymentIntent = async (paymentIntent) => {
        const txHash = paymentIntent?.txHash;
        const context = { intent: paymentIntent, config, txHash };

        if (!canonicalTxHashPattern.test(txHash || "")) {
            return rejectResult(PAYMENT_VERIFICATION_CODES.INVALID_TX_HASH, context);
        }

        try {
            const method = paymentIntent.paymentMethodSnapshot || null;
            const allowedMethod = method?.id ? getAllowedPaymentMethod(method.id) : null;

            if (!method || !allowedMethod || paymentIntent.paymentMethodId !== method.id) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.WRONG_METHOD, context);
            }

            const configuredTokenAddress = normalizeEvmAddress(method.tokenAddress);
            const intentTokenAddress = normalizeEvmAddress(paymentIntent.tokenAddress);
            const configuredTreasuryAddress = normalizeEvmAddress(method.treasuryAddress);
            const intentRecipientAddress = normalizeEvmAddress(paymentIntent.recipientAddress);
            const intentPayerAddress = normalizeEvmAddress(paymentIntent.payerAddress);

            if (
                paymentIntent.chainId !== method.chainId ||
                method.chainId !== allowedMethod.chainId ||
                method.network !== allowedMethod.network
            ) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.WRONG_NETWORK, context);
            }

            const verifierProvider = provider || providerFactory(method);
            const networkChainId = await verifierProvider.getNetworkChainId();
            if (networkChainId !== method.chainId) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.WRONG_NETWORK, context);
            }

            if (
                !configuredTokenAddress ||
                !intentTokenAddress ||
                configuredTokenAddress !== allowedMethod.tokenAddress ||
                intentTokenAddress !== configuredTokenAddress ||
                paymentIntent.tokenSymbol !== method.tokenSymbol ||
                paymentIntent.tokenDecimals !== method.tokenDecimals ||
                method.tokenSymbol !== allowedMethod.tokenSymbol ||
                method.tokenDecimals !== allowedMethod.tokenDecimals
            ) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.WRONG_TOKEN, context);
            }

            if (
                !configuredTreasuryAddress ||
                !intentRecipientAddress ||
                intentRecipientAddress !== configuredTreasuryAddress
            ) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.WRONG_RECIPIENT, context);
            }

            if (!isValidExpectedAmount(paymentIntent.expectedTokenAmountBaseUnits)) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.INVALID_AMOUNT, context);
            }

            const transaction = await verifierProvider.getTransaction(txHash);
            if (!transaction) {
                return pendingResult(PAYMENT_VERIFICATION_CODES.TX_NOT_FOUND, context);
            }

            const receipt = await verifierProvider.getTransactionReceipt(txHash);
            if (!receipt) {
                return pendingResult(PAYMENT_VERIFICATION_CODES.RECEIPT_NOT_FOUND, context);
            }

            if (!Number.isInteger(receipt.blockNumber) || receipt.blockNumber < 0) {
                return createResult({
                    ...context,
                    outcome: PAYMENT_OUTCOMES.REJECTED,
                    code: PAYMENT_VERIFICATION_CODES.INVALID_RECEIPT,
                    retryable: true,
                    transactionStatus: receipt.status === 1 ? "SUCCESS" : "REVERTED"
                });
            }

            const confirmedBlock = receipt.blockNumber;
            const firstSeenBlock = transaction.blockNumber ?? confirmedBlock;
            const currentBlock = await verifierProvider.getBlockNumber();
            const confirmationCount = Math.max(0, currentBlock - confirmedBlock + 1);
            const receiptContext = {
                ...context,
                firstSeenBlock,
                confirmedBlock,
                confirmationCount,
                transactionStatus: receipt.status === 1 ? "SUCCESS" : "REVERTED"
            };

            if (receipt.status !== 1) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.TX_REVERTED, receiptContext);
            }

            const transfers = verifierProvider.parseTransferLogs(receipt, configuredTokenAddress);
            const matchingTransfers = transfers.filter(transfer => transfer.to === configuredTreasuryAddress);

            if (matchingTransfers.length === 0) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.TRANSFER_NOT_FOUND, receiptContext);
            }

            if (matchingTransfers.length > 1) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.TRANSFER_AMBIGUOUS, receiptContext);
            }

            const [transfer] = matchingTransfers;
            const verifiedTokenAmountBaseUnits = transfer.value.toString();
            const expectedAmount = BigInt(paymentIntent.expectedTokenAmountBaseUnits);
            const transferContext = {
                ...receiptContext,
                fromAddress: transfer.from,
                verifiedTokenAmountBaseUnits
            };

            if (!intentPayerAddress || transfer.from !== intentPayerAddress) {
                return rejectResult(PAYMENT_VERIFICATION_CODES.WRONG_PAYER, transferContext);
            }

            if (confirmationCount < method.confirmations) {
                return createResult({
                    ...transferContext,
                    outcome: PAYMENT_OUTCOMES.CONFIRMING,
                    code: PAYMENT_VERIFICATION_CODES.CONFIRMING,
                    retryable: true
                });
            }

            if (transfer.value < expectedAmount) {
                return createResult({
                    ...transferContext,
                    outcome: PAYMENT_OUTCOMES.UNDERPAID,
                    code: PAYMENT_VERIFICATION_CODES.UNDERPAID
                });
            }

            if (transfer.value > expectedAmount) {
                return createResult({
                    ...transferContext,
                    outcome: PAYMENT_OUTCOMES.OVERPAID,
                    code: PAYMENT_VERIFICATION_CODES.OVERPAID
                });
            }

            return createResult({
                ...transferContext,
                outcome: PAYMENT_OUTCOMES.VERIFIED,
                code: PAYMENT_VERIFICATION_CODES.VERIFIED
            });
        } catch {
            return createResult({
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
    PAYMENT_OUTCOMES,
    PAYMENT_VERIFICATION_CODES,
    createPaymentVerifier
};
