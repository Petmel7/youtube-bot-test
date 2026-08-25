const test = require("node:test");
const assert = require("node:assert/strict");
const { Interface } = require("ethers");

const { createEvmProvider } = require("../src/services/payments/evmProvider");
const {
    PAYMENT_OUTCOMES,
    PAYMENT_VERIFICATION_CODES,
    createPaymentVerifier
} = require("../src/services/payments/paymentVerifier");
const { createSolanaPaymentVerifier } = require("../src/services/payments/solanaPaymentVerifier");

const baseUsdcAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const baseSepoliaUsdcAddress = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const treasuryAddress = "0x1111111111111111111111111111111111111111";
const senderAddress = "0x2222222222222222222222222222222222222222";
const otherAddress = "0x3333333333333333333333333333333333333333";
const otherTokenAddress = "0x4444444444444444444444444444444444444444";
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const encodeBase58 = (buffer) => {
    let digits = [0];
    for (const byte of buffer) {
        let carry = byte;
        for (let index = 0; index < digits.length; index += 1) {
            carry += digits[index] << 8;
            digits[index] = carry % 58;
            carry = Math.floor(carry / 58);
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = Math.floor(carry / 58);
        }
    }
    return digits.reverse().map(digit => base58Alphabet[digit]).join("");
};
const txHash = `0x${"a".repeat(64)}`;
const solanaSignature = encodeBase58(Buffer.alloc(64, 7));
const solanaPayerAddress = "9xQeWvG816bUx9EPfDTwBX7VgQZnE8qNvSgtV6fSTH3";
const solanaTreasuryAddress = "8qbHbw2DZ7YFgfTwD5WfoG5f8XjQwP36N3WBsAtJLWqe";
const solanaDevnetUsdcMint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const transferInterface = new Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

const config = {
    chainId: 8453,
    rpcUrl: "https://base.example.invalid/rpc",
    tokenAddress: baseUsdcAddress,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    treasuryAddress,
    confirmations: 60
};

const sepoliaConfig = {
    ...config,
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    tokenAddress: baseSepoliaUsdcAddress
};

const methodSnapshot = (overrides = {}) => ({
    id: "base-mainnet-usdc",
    name: "Base mainnet USDC",
    network: "base-mainnet",
    chainId: 8453,
    rpcUrl: config.rpcUrl,
    tokenAddress: baseUsdcAddress,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    treasuryAddress,
    confirmations: 60,
    enabled: true,
    production: true,
    ...overrides
});

const makeTransferLog = ({
    tokenAddress = baseUsdcAddress,
    from = senderAddress,
    to = treasuryAddress,
    value = 5000000n
} = {}) => {
    const event = transferInterface.getEvent("Transfer");
    const encoded = transferInterface.encodeEventLog(event, [from, to, value]);
    return { address: tokenAddress, topics: encoded.topics, data: encoded.data };
};

const makeIntent = (overrides = {}) => ({
    paymentMethodId: "base-mainnet-usdc",
    paymentMethodSnapshot: methodSnapshot(),
    chainId: 8453,
    tokenAddress: baseUsdcAddress,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    recipientAddress: treasuryAddress,
    payerAddress: senderAddress,
    expectedTokenAmountBaseUnits: "5000000",
    txHash,
    ...overrides
});

const solanaMethodSnapshot = (overrides = {}) => ({
    id: "solana-devnet-usdc",
    name: "Solana devnet USDC",
    namespace: "solana",
    network: "solana-devnet",
    networkId: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    cluster: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    assetType: "spl-token",
    mintAddress: solanaDevnetUsdcMint,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    treasuryAddress: solanaTreasuryAddress,
    confirmations: 1,
    enabled: true,
    production: false,
    ...overrides
});

const makeSolanaIntent = (overrides = {}) => ({
    paymentMethodId: "solana-devnet-usdc",
    namespace: "solana",
    networkId: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    paymentMethodSnapshot: solanaMethodSnapshot(),
    chainId: null,
    tokenAddress: null,
    mintAddress: solanaDevnetUsdcMint,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    recipientAddress: solanaTreasuryAddress,
    payerAddress: solanaPayerAddress,
    expectedTokenAmountBaseUnits: "5000000",
    txHash: solanaSignature,
    ...overrides
});

const makeSolanaProvider = ({
    genesisHash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    signatureStatus = { slot: 123, confirmations: null, confirmationStatus: "finalized", err: null },
    transaction = { slot: 123, meta: { err: null } },
    transfer = { from: solanaPayerAddress, to: solanaTreasuryAddress, value: 5000000n }
} = {}) => ({
    async getGenesisHash() {
        return genesisHash;
    },
    async getSignatureStatus() {
        return signatureStatus;
    },
    async getParsedTransaction() {
        return transaction;
    },
    findTokenTransfer() {
        return transfer;
    }
});

const makeReceipt = (overrides = {}) => ({
    status: 1,
    blockNumber: 100,
    logs: [makeTransferLog()],
    ...overrides
});

const makeProvider = ({
    chainId = 8453,
    transaction = { hash: txHash, blockNumber: 100 },
    receipt = makeReceipt(),
    currentBlock = 159,
    throwOn
} = {}) => ({
    calls: {
        getNetworkChainId: 0,
        getTransaction: 0,
        getTransactionReceipt: 0,
        getBlockNumber: 0,
        parseTransferLogs: 0
    },
    async getNetworkChainId() {
        this.calls.getNetworkChainId += 1;
        if (throwOn === "getNetworkChainId") throw new Error("network unavailable");
        return chainId;
    },
    async getTransaction() {
        this.calls.getTransaction += 1;
        if (throwOn === "getTransaction") throw new Error("transaction unavailable");
        return transaction;
    },
    async getTransactionReceipt() {
        this.calls.getTransactionReceipt += 1;
        if (throwOn === "getTransactionReceipt") throw new Error("receipt unavailable");
        return receipt;
    },
    async getBlockNumber() {
        this.calls.getBlockNumber += 1;
        if (throwOn === "getBlockNumber") throw new Error("block unavailable");
        return currentBlock;
    },
    parseTransferLogs(receiptToParse, tokenAddress) {
        this.calls.parseTransferLogs += 1;
        if (throwOn === "parseTransferLogs") throw new Error("parse unavailable");
        return createEvmProvider({ provider: this }).parseTransferLogs(receiptToParse, tokenAddress);
    }
});

const verifyWith = async ({ provider = makeProvider(), intent = makeIntent(), verifierConfig = config } = {}) => (
    createPaymentVerifier({ provider, config: verifierConfig }).verifyPaymentIntent(intent)
);

const stableStringify = (value) => JSON.stringify(value, Object.keys(value).sort());

test("EVM provider constructs an ethers JsonRpcProvider from configured RPC and exposes only narrow operations", async () => {
    let constructedRpcUrl = null;
    class FakeProvider {
        constructor(rpcUrl) {
            constructedRpcUrl = rpcUrl;
        }

        async getNetwork() {
            return { chainId: 8453n };
        }
    }

    const provider = createEvmProvider({ rpcUrl: config.rpcUrl, ProviderClass: FakeProvider });

    assert.equal(constructedRpcUrl, config.rpcUrl);
    assert.equal(await provider.getNetworkChainId(), 8453);
    assert.equal(typeof provider.getSigner, "undefined");
    assert.equal(typeof provider.sendTransaction, "undefined");
});

test("EVM provider parses Base USDC Transfer logs and ignores unrelated token logs", () => {
    const provider = createEvmProvider({ provider: makeProvider() });
    const receipt = {
        logs: [
            makeTransferLog({ tokenAddress: otherTokenAddress, value: 999n }),
            makeTransferLog({ value: 5000000n })
        ]
    };

    assert.deepEqual(provider.parseTransferLogs(receipt, baseUsdcAddress), [{
        from: senderAddress,
        to: treasuryAddress,
        value: 5000000n
    }]);
});

test("PaymentVerifier rejects malformed and non-canonical transaction hashes before RPC calls", async () => {
    const provider = makeProvider();

    assert.equal((await verifyWith({ provider, intent: makeIntent({ txHash: null }) })).code, PAYMENT_VERIFICATION_CODES.INVALID_TX_HASH);
    assert.equal((await verifyWith({ provider, intent: makeIntent({ txHash: "0x123" }) })).code, PAYMENT_VERIFICATION_CODES.INVALID_TX_HASH);
    assert.equal((await verifyWith({ provider, intent: makeIntent({ txHash: `0x${"A".repeat(64)}` }) })).code, PAYMENT_VERIFICATION_CODES.INVALID_TX_HASH);
    assert.equal(provider.calls.getNetworkChainId, 0);
});

test("PaymentVerifier rejects wrong provider network and frontend cannot override chain", async () => {
    assert.deepEqual(await verifyWith({ provider: makeProvider({ chainId: 1 }) }), {
        outcome: PAYMENT_OUTCOMES.REJECTED,
        code: PAYMENT_VERIFICATION_CODES.WRONG_NETWORK,
        retryable: false,
        chainId: 8453,
        txHash,
        tokenAddress: baseUsdcAddress,
        tokenDecimals: 6,
        recipientAddress: treasuryAddress,
        payerAddress: senderAddress,
        fromAddress: null,
        verifiedTokenAmountBaseUnits: null,
        expectedTokenAmountBaseUnits: "5000000",
        firstSeenBlock: null,
        confirmedBlock: null,
        confirmationCount: null,
        transactionStatus: null
    });

    const result = await verifyWith({ intent: makeIntent({ chainId: 1, frontendChainId: 8453 }) });
    assert.equal(result.code, PAYMENT_VERIFICATION_CODES.WRONG_NETWORK);
});

test("PaymentVerifier rejects missing or tampered payment method snapshot", async () => {
    assert.equal((await verifyWith({
        intent: makeIntent({ paymentMethodSnapshot: null })
    })).code, PAYMENT_VERIFICATION_CODES.WRONG_METHOD);

    assert.equal((await verifyWith({
        intent: makeIntent({
            paymentMethodId: "base-mainnet-usdc",
            paymentMethodSnapshot: methodSnapshot({ id: "base-sepolia-usdc" })
        })
    })).code, PAYMENT_VERIFICATION_CODES.WRONG_METHOD);

    assert.equal((await verifyWith({
        intent: makeIntent({
            paymentMethodSnapshot: methodSnapshot({ chainId: 84532 })
        })
    })).code, PAYMENT_VERIFICATION_CODES.WRONG_NETWORK);
});

test("PaymentVerifier accepts configured Base Sepolia chain and token", async () => {
    const result = await verifyWith({
        verifierConfig: sepoliaConfig,
        intent: makeIntent({
            paymentMethodId: "base-sepolia-usdc",
            paymentMethodSnapshot: methodSnapshot({
                id: "base-sepolia-usdc",
                name: "Base Sepolia USDC",
                network: "base-sepolia",
                chainId: 84532,
                rpcUrl: sepoliaConfig.rpcUrl,
                tokenAddress: baseSepoliaUsdcAddress
            }),
            chainId: 84532,
            tokenAddress: baseSepoliaUsdcAddress
        }),
        provider: makeProvider({
            chainId: 84532,
            receipt: makeReceipt({
                logs: [makeTransferLog({ tokenAddress: baseSepoliaUsdcAddress })]
            })
        })
    });

    assert.equal(result.outcome, PAYMENT_OUTCOMES.VERIFIED);
    assert.equal(result.chainId, 84532);
    assert.equal(result.tokenAddress, baseSepoliaUsdcAddress);
});

test("PaymentVerifier returns pending when transaction or receipt is missing", async () => {
    const missingTransaction = await verifyWith({ provider: makeProvider({ transaction: null }) });
    assert.equal(missingTransaction.outcome, PAYMENT_OUTCOMES.PENDING);
    assert.equal(missingTransaction.code, PAYMENT_VERIFICATION_CODES.TX_NOT_FOUND);
    assert.equal(missingTransaction.retryable, true);

    const missingReceipt = await verifyWith({ provider: makeProvider({ receipt: null }) });
    assert.equal(missingReceipt.outcome, PAYMENT_OUTCOMES.PENDING);
    assert.equal(missingReceipt.code, PAYMENT_VERIFICATION_CODES.RECEIPT_NOT_FOUND);
    assert.equal(missingReceipt.retryable, true);
});

test("PaymentVerifier rejects reverted receipts", async () => {
    const result = await verifyWith({ provider: makeProvider({ receipt: makeReceipt({ status: 0 }) }) });

    assert.equal(result.outcome, PAYMENT_OUTCOMES.REJECTED);
    assert.equal(result.code, PAYMENT_VERIFICATION_CODES.TX_REVERTED);
    assert.equal(result.transactionStatus, "REVERTED");
});

test("PaymentVerifier rejects wrong token contract and frontend cannot override token", async () => {
    const wrongIntentToken = await verifyWith({
        intent: makeIntent({ tokenAddress: otherTokenAddress, frontendTokenAddress: baseUsdcAddress })
    });
    assert.equal(wrongIntentToken.code, PAYMENT_VERIFICATION_CODES.WRONG_TOKEN);

    const wrongSnapshotToken = await verifyWith({
        intent: makeIntent({
            paymentMethodSnapshot: methodSnapshot({ tokenAddress: otherTokenAddress })
        })
    });
    assert.equal(wrongSnapshotToken.code, PAYMENT_VERIFICATION_CODES.WRONG_TOKEN);

    const mismatchedSepoliaToken = await verifyWith({
        intent: makeIntent({
            paymentMethodId: "base-sepolia-usdc",
            paymentMethodSnapshot: methodSnapshot({
                id: "base-sepolia-usdc",
                name: "Base Sepolia USDC",
                network: "base-sepolia",
                chainId: 84532,
                rpcUrl: sepoliaConfig.rpcUrl,
                tokenAddress: baseUsdcAddress
            }),
            chainId: 84532,
            tokenAddress: baseUsdcAddress
        }),
        provider: makeProvider({ chainId: 84532 })
    });
    assert.equal(mismatchedSepoliaToken.code, PAYMENT_VERIFICATION_CODES.WRONG_TOKEN);
});

test("PaymentVerifier rejects no matching, ambiguous, and wrong-recipient transfers", async () => {
    const noMatching = await verifyWith({ provider: makeProvider({ receipt: makeReceipt({ logs: [] }) }) });
    assert.equal(noMatching.code, PAYMENT_VERIFICATION_CODES.TRANSFER_NOT_FOUND);

    const wrongRecipient = await verifyWith({
        provider: makeProvider({ receipt: makeReceipt({ logs: [makeTransferLog({ to: otherAddress })] }) })
    });
    assert.equal(wrongRecipient.code, PAYMENT_VERIFICATION_CODES.TRANSFER_NOT_FOUND);

    const ambiguous = await verifyWith({
        provider: makeProvider({ receipt: makeReceipt({ logs: [makeTransferLog(), makeTransferLog({ value: 6000000n })] }) })
    });
    assert.equal(ambiguous.code, PAYMENT_VERIFICATION_CODES.TRANSFER_AMBIGUOUS);
});

test("PaymentVerifier rejects transfers from a wallet other than bound payer", async () => {
    const result = await verifyWith({
        intent: makeIntent({ payerAddress: otherAddress })
    });

    assert.equal(result.outcome, PAYMENT_OUTCOMES.REJECTED);
    assert.equal(result.code, PAYMENT_VERIFICATION_CODES.WRONG_PAYER);
    assert.equal(result.fromAddress, senderAddress);
});

test("PaymentVerifier rejects frozen recipient mismatch and frontend cannot override recipient", async () => {
    const result = await verifyWith({
        intent: makeIntent({ recipientAddress: otherAddress, frontendRecipientAddress: treasuryAddress })
    });

    assert.equal(result.outcome, PAYMENT_OUTCOMES.REJECTED);
    assert.equal(result.code, PAYMENT_VERIFICATION_CODES.WRONG_RECIPIENT);
});

test("PaymentVerifier compares token amounts exactly with BigInt and rejects invalid expected amounts", async () => {
    assert.equal((await verifyWith()).outcome, PAYMENT_OUTCOMES.VERIFIED);

    const underpaid = await verifyWith({
        provider: makeProvider({ receipt: makeReceipt({ logs: [makeTransferLog({ value: 4999999n })] }) })
    });
    assert.equal(underpaid.outcome, PAYMENT_OUTCOMES.UNDERPAID);
    assert.equal(underpaid.code, PAYMENT_VERIFICATION_CODES.UNDERPAID);

    const overpaid = await verifyWith({
        provider: makeProvider({ receipt: makeReceipt({ logs: [makeTransferLog({ value: 5000001n })] }) })
    });
    assert.equal(overpaid.outcome, PAYMENT_OUTCOMES.OVERPAID);
    assert.equal(overpaid.code, PAYMENT_VERIFICATION_CODES.OVERPAID);

    const largeAmount = 2n ** 200n;
    const largeResult = await verifyWith({
        intent: makeIntent({ expectedTokenAmountBaseUnits: largeAmount.toString(), frontendAmount: "1" }),
        provider: makeProvider({ receipt: makeReceipt({ logs: [makeTransferLog({ value: largeAmount })] }) })
    });
    assert.equal(largeResult.outcome, PAYMENT_OUTCOMES.VERIFIED);
    assert.equal(largeResult.verifiedTokenAmountBaseUnits, largeAmount.toString());

    assert.equal((await verifyWith({ intent: makeIntent({ expectedTokenAmountBaseUnits: "01" }) })).code, PAYMENT_VERIFICATION_CODES.INVALID_AMOUNT);
    assert.equal((await verifyWith({ intent: makeIntent({ expectedTokenAmountBaseUnits: "0" }) })).code, PAYMENT_VERIFICATION_CODES.INVALID_AMOUNT);
});

test("PaymentVerifier confirmation threshold dominates amount terminal outcomes", async () => {
    const exactBelow = await verifyWith({ provider: makeProvider({ currentBlock: 158 }) });
    assert.equal(exactBelow.outcome, PAYMENT_OUTCOMES.CONFIRMING);
    assert.equal(exactBelow.code, PAYMENT_VERIFICATION_CODES.CONFIRMING);
    assert.equal(exactBelow.confirmationCount, 59);

    const underpaidBelow = await verifyWith({
        provider: makeProvider({
            currentBlock: 158,
            receipt: makeReceipt({ logs: [makeTransferLog({ value: 4999999n })] })
        })
    });
    assert.equal(underpaidBelow.outcome, PAYMENT_OUTCOMES.CONFIRMING);
    assert.equal(underpaidBelow.code, PAYMENT_VERIFICATION_CODES.CONFIRMING);
    assert.notEqual(underpaidBelow.outcome, PAYMENT_OUTCOMES.UNDERPAID);
    assert.equal(underpaidBelow.verifiedTokenAmountBaseUnits, "4999999");

    const overpaidBelow = await verifyWith({
        provider: makeProvider({
            currentBlock: 158,
            receipt: makeReceipt({ logs: [makeTransferLog({ value: 5000001n })] })
        })
    });
    assert.equal(overpaidBelow.outcome, PAYMENT_OUTCOMES.CONFIRMING);
    assert.equal(overpaidBelow.code, PAYMENT_VERIFICATION_CODES.CONFIRMING);
    assert.notEqual(overpaidBelow.outcome, PAYMENT_OUTCOMES.OVERPAID);
    assert.equal(overpaidBelow.verifiedTokenAmountBaseUnits, "5000001");

    const exact = await verifyWith({ provider: makeProvider({ currentBlock: 159 }) });
    assert.equal(exact.outcome, PAYMENT_OUTCOMES.VERIFIED);
    assert.equal(exact.confirmationCount, 60);

    const underpaid = await verifyWith({
        provider: makeProvider({
            currentBlock: 159,
            receipt: makeReceipt({ logs: [makeTransferLog({ value: 4999999n })] })
        })
    });
    assert.equal(underpaid.outcome, PAYMENT_OUTCOMES.UNDERPAID);
    assert.equal(underpaid.code, PAYMENT_VERIFICATION_CODES.UNDERPAID);

    const overpaid = await verifyWith({
        provider: makeProvider({
            currentBlock: 159,
            receipt: makeReceipt({ logs: [makeTransferLog({ value: 5000001n })] })
        })
    });
    assert.equal(overpaid.outcome, PAYMENT_OUTCOMES.OVERPAID);
    assert.equal(overpaid.code, PAYMENT_VERIFICATION_CODES.OVERPAID);

    const above = await verifyWith({ provider: makeProvider({ currentBlock: 160 }) });
    assert.equal(above.outcome, PAYMENT_OUTCOMES.VERIFIED);
    assert.equal(above.confirmationCount, 61);
});

test("PaymentVerifier rejects invalid receipt block numbers before confirmation calculation", async () => {
    const withoutBlockNumber = await verifyWith({
        provider: makeProvider({ receipt: { status: 1, logs: [makeTransferLog()] } })
    });
    assert.equal(withoutBlockNumber.outcome, PAYMENT_OUTCOMES.REJECTED);
    assert.equal(withoutBlockNumber.code, PAYMENT_VERIFICATION_CODES.INVALID_RECEIPT);
    assert.equal(withoutBlockNumber.retryable, true);
    assert.notEqual(withoutBlockNumber.outcome, PAYMENT_OUTCOMES.CONFIRMING);

    const undefinedBlockNumber = await verifyWith({
        provider: makeProvider({ receipt: makeReceipt({ blockNumber: undefined }) })
    });
    assert.equal(undefinedBlockNumber.code, PAYMENT_VERIFICATION_CODES.INVALID_RECEIPT);

    const nonIntegerBlockNumber = await verifyWith({
        provider: makeProvider({ receipt: makeReceipt({ blockNumber: 100.5 }) })
    });
    assert.equal(nonIntegerBlockNumber.code, PAYMENT_VERIFICATION_CODES.INVALID_RECEIPT);

    const negativeBlockNumber = await verifyWith({
        provider: makeProvider({ receipt: makeReceipt({ blockNumber: -1 }) })
    });
    assert.equal(negativeBlockNumber.code, PAYMENT_VERIFICATION_CODES.INVALID_RECEIPT);
});

test("PaymentVerifier VERIFIED result contains backend-derived fields", async () => {
    const result = await verifyWith();

    assert.deepEqual(result, {
        outcome: PAYMENT_OUTCOMES.VERIFIED,
        code: PAYMENT_VERIFICATION_CODES.VERIFIED,
        retryable: false,
        chainId: 8453,
        txHash,
        tokenAddress: baseUsdcAddress,
        tokenDecimals: 6,
        recipientAddress: treasuryAddress,
        payerAddress: senderAddress,
        fromAddress: senderAddress,
        verifiedTokenAmountBaseUnits: "5000000",
        expectedTokenAmountBaseUnits: "5000000",
        firstSeenBlock: 100,
        confirmedBlock: 100,
        confirmationCount: 60,
        transactionStatus: "SUCCESS"
    });
});

test("PaymentVerifier returns deterministic retryable provider failures without exposing raw errors", async () => {
    const result = await verifyWith({ provider: makeProvider({ throwOn: "getTransaction" }) });

    assert.equal(result.outcome, PAYMENT_OUTCOMES.REJECTED);
    assert.equal(result.code, PAYMENT_VERIFICATION_CODES.PROVIDER_FAILURE);
    assert.equal(result.retryable, true);
    assert.equal(result.message, undefined);
});

test("PaymentVerifier is deterministic and does not mutate the supplied PaymentIntent", async () => {
    const intent = makeIntent();
    const before = stableStringify(intent);
    const provider = makeProvider();
    const first = await verifyWith({ provider, intent });
    const second = await verifyWith({ provider, intent });

    assert.equal(stableStringify(intent), before);
    assert.deepEqual(second, first);
    assert.equal(provider.calls.getTransaction, 2);
    assert.equal(provider.calls.getTransactionReceipt, 2);
    assert.equal(provider.calls.parseTransferLogs, 2);
});

test("PaymentVerifier does not invoke application persistence or settlement code", async () => {
    const forbidden = () => {
        throw new Error("application persistence should not be called");
    };
    const intent = makeIntent({
        save: forbidden,
        updateOne: forbidden
    });
    const provider = makeProvider({
        walletUpdateOne: forbidden,
        walletTransactionCreate: forbidden,
        paymentIntentFindOneAndUpdate: forbidden,
        finalizeCharge: forbidden,
        grantDevelopmentCredits: forbidden
    });

    const result = await verifyWith({ provider, intent });

    assert.equal(result.outcome, PAYMENT_OUTCOMES.VERIFIED);
    assert.equal(provider.calls.getTransaction, 1);
    assert.equal(provider.calls.getTransactionReceipt, 1);
    assert.equal(provider.calls.parseTransferLogs, 1);
});

test("Solana verifier accepts finalized SPL token transfer from bound payer", async () => {
    const result = await createSolanaPaymentVerifier({
        provider: makeSolanaProvider()
    }).verifyPaymentIntent(makeSolanaIntent());

    assert.equal(result.outcome, PAYMENT_OUTCOMES.VERIFIED);
    assert.equal(result.code, PAYMENT_VERIFICATION_CODES.VERIFIED);
    assert.equal(result.txHash, solanaSignature);
    assert.equal(result.fromAddress, solanaPayerAddress);
    assert.equal(result.verifiedTokenAmountBaseUnits, "5000000");
    assert.equal(result.transactionStatus, "SUCCESS");
});

test("Solana verifier rejects wrong mint, destination, and underpayment safely", async () => {
    assert.equal((await createSolanaPaymentVerifier({
        provider: makeSolanaProvider()
    }).verifyPaymentIntent(makeSolanaIntent({ mintAddress: "11111111111111111111111111111111" }))).code, PAYMENT_VERIFICATION_CODES.WRONG_TOKEN);

    assert.equal((await createSolanaPaymentVerifier({
        provider: makeSolanaProvider({ transfer: null })
    }).verifyPaymentIntent(makeSolanaIntent())).code, PAYMENT_VERIFICATION_CODES.TRANSFER_NOT_FOUND);

    const underpaid = await createSolanaPaymentVerifier({
        provider: makeSolanaProvider({ transfer: { from: solanaPayerAddress, to: solanaTreasuryAddress, value: 4999999n } })
    }).verifyPaymentIntent(makeSolanaIntent());
    assert.equal(underpaid.outcome, PAYMENT_OUTCOMES.UNDERPAID);
});

test("Solana verifier treats pending transaction as retryable and rejects wrong payer", async () => {
    const pending = await createSolanaPaymentVerifier({
        provider: makeSolanaProvider({ signatureStatus: null })
    }).verifyPaymentIntent(makeSolanaIntent());
    assert.equal(pending.outcome, PAYMENT_OUTCOMES.PENDING);
    assert.equal(pending.retryable, true);

    const wrongPayer = await createSolanaPaymentVerifier({
        provider: makeSolanaProvider({ transfer: { from: "8qbHbw2DZ7YFgfTwD5WfoG5f8XjQwP36N3WBsAtJLWqe", to: solanaTreasuryAddress, value: 5000000n } })
    }).verifyPaymentIntent(makeSolanaIntent());
    assert.equal(wrongPayer.code, PAYMENT_VERIFICATION_CODES.WRONG_PAYER);
});

test("top-level PaymentVerifier dispatches Solana intents away from EVM verifier", async () => {
    const result = await createPaymentVerifier({
        solanaVerifier: {
            async verifyPaymentIntent(intent) {
                return {
                    outcome: PAYMENT_OUTCOMES.VERIFIED,
                    code: PAYMENT_VERIFICATION_CODES.VERIFIED,
                    txHash: intent.txHash
                };
            }
        }
    }).verifyPaymentIntent(makeSolanaIntent());

    assert.equal(result.outcome, PAYMENT_OUTCOMES.VERIFIED);
    assert.equal(result.txHash, solanaSignature);
});
