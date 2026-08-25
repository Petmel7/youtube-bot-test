const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { Wallet: EthersWallet } = require("ethers");

const PaymentIntent = require("../src/models/PaymentIntent");
const PaymentPayerChallenge = require("../src/models/PaymentPayerChallenge");
const { normalizeEvmAddress } = require("../src/utils/evmAddress");
const { validatePaymentConfig } = require("../src/config/validateEnv");
const {
    createPaymentPricingService,
    parsePaymentPackages
} = require("../src/services/billing/paymentPricingService");
const { createPaymentIntentService } = require("../src/services/billing/paymentIntentService");
const {
    buildChallengeMessage,
    createPaymentPayerChallengeService
} = require("../src/services/payments/paymentPayerChallengeService");

const baseUsdcAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const baseSepoliaUsdcAddress = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";
const bnbUsdtAddress = "0x55d398326f99059ff775485246999027b3197955";
const treasuryAddress = "0x1111111111111111111111111111111111111111";
const payerAddress = "0x2222222222222222222222222222222222222222";
const payerChallengeId = new mongoose.Types.ObjectId();
const validSignature = `0x${"a".repeat(130)}`;
const validPackagesJson = JSON.stringify([
    {
        packageId: "starter_credits",
        creditAmount: 750,
        expectedUsdAmountMinor: 500,
        expectedTokenAmountBaseUnits: "5000000"
    },
    {
        packageId: "growth_credits",
        creditAmount: 1800,
        expectedUsdAmountMinor: 1200,
        expectedTokenAmountBaseUnits: "12000000"
    }
]);

const validPaymentConfig = (overrides = {}) => ({
    network: "base-mainnet",
    allowTestnetPayments: false,
    chainId: 8453,
    rpcUrl: "https://base.example.invalid/rpc",
    tokenAddress: baseUsdcAddress,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    treasuryAddress,
    confirmations: 60,
    verifyThrottleWindowMs: 60000,
    verifyThrottleMax: 10,
    intentTtlMinutes: 30,
    pricingVersion: "phase3a-test-v1",
    packagesJson: validPackagesJson,
    ...overrides
});

const baseMethodSnapshot = (overrides = {}) => ({
    id: "base-mainnet-usdc",
    name: "Base mainnet USDC",
    network: "base-mainnet",
    chainId: 8453,
    rpcUrl: "https://base.example.invalid/rpc",
    tokenAddress: baseUsdcAddress,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    treasuryAddress,
    confirmations: 60,
    enabled: true,
    production: true,
    ...overrides
});

const validPaymentIntentDocument = (overrides = {}) => ({
    userId: new mongoose.Types.ObjectId(),
    idempotencyKey: "idem-1",
    packageId: "starter_credits",
    paymentMethodId: "base-mainnet-usdc",
    paymentMethodSnapshot: baseMethodSnapshot(),
    chainId: 8453,
    tokenAddress: normalizeEvmAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    recipientAddress: treasuryAddress,
    expectedTokenAmountBaseUnits: "5000000",
    expectedUsdAmountMinor: 500,
    creditAmount: 750,
    pricingVersion: "pricing-v1",
    payerAddress,
    payerChallengeId,
    expiresAt: new Date("2026-08-17T10:30:00.000Z"),
    ...overrides
});

const query = (value) => ({
    session() {
        return this;
    },
    then(resolve, reject) {
        return Promise.resolve(value).then(resolve, reject);
    }
});

const clone = (value) => value ? { ...value } : null;

const createFakePaymentIntentModel = () => {
    const intents = [];
    let nextId = 1;

    const model = {
        intents,
        findOne(filter) {
            const found = intents.find(intent => (
                String(intent.userId) === String(filter.userId) &&
                intent.idempotencyKey === filter.idempotencyKey
            ));
            return query(clone(found));
        },
        async create(entries) {
            return entries.map((entry) => {
                const duplicate = intents.some(intent => (
                    String(intent.userId) === String(entry.userId) &&
                    intent.idempotencyKey === entry.idempotencyKey
                ));

                if (duplicate) {
                    const error = new Error("duplicate key");
                    error.code = 11000;
                    throw error;
                }

                const doc = {
                    _id: `intent-${nextId++}`,
                    status: "PENDING",
                    ...entry,
                    createdAt: new Date("2026-01-01T00:00:00.000Z"),
                    updatedAt: new Date("2026-01-01T00:00:00.000Z")
                };
                intents.push(doc);
                return clone(doc);
            });
        }
    };

    return model;
};

const createFakePayerChallengeService = () => ({
    calls: [],
    async verifyAndUseChallenge(args) {
        this.calls.push(args);
        return {
            payerAddress,
            challenge: { _id: args.payerChallengeId }
        };
    }
});

const createFakeChallengeModel = (initialChallenges = []) => {
    const challenges = new Map(initialChallenges.map(challenge => [String(challenge._id), clone(challenge)]));

    return {
        challenges,
        async create(entries) {
            return entries.map((entry, index) => {
                const doc = {
                    _id: entry._id || new mongoose.Types.ObjectId(`64f00000000000000000000${index + 1}`),
                    ...entry,
                    createdAt: new Date("2026-08-17T10:00:00.000Z"),
                    updatedAt: new Date("2026-08-17T10:00:00.000Z")
                };
                challenges.set(String(doc._id), doc);
                return clone(doc);
            });
        },
        findOne(filter) {
            const found = [...challenges.values()].find((challenge) => {
                if (filter._id && String(challenge._id) !== String(filter._id)) return false;
                if (filter.userId && String(challenge.userId) !== String(filter.userId)) return false;
                return true;
            });
            return query(clone(found));
        },
        findOneAndUpdate(filter, update, options = {}) {
            const found = [...challenges.values()].find((challenge) => {
                if (filter._id && String(challenge._id) !== String(filter._id)) return false;
                if (filter.userId && String(challenge.userId) !== String(filter.userId)) return false;
                if (filter.usedAt === null && challenge.usedAt !== null && challenge.usedAt !== undefined) return false;
                if (filter.expiresAt?.$gt && challenge.expiresAt.getTime() <= filter.expiresAt.$gt.getTime()) return false;
                return true;
            });
            if (!found) return query(null);
            if (update.$set) Object.assign(found, update.$set);
            return query(options.new ? clone(found) : clone({ ...found, ...update.$set }));
        }
    };
};

test("payment config validation accepts production Base mainnet USDC config", () => {
    assert.doesNotThrow(() => validatePaymentConfig(validPaymentConfig(), { nodeEnv: "production" }));
    assert.doesNotThrow(() => validatePaymentConfig(validPaymentConfig(), { nodeEnv: "development" }));
});

test("payment config validation accepts Base Sepolia only with explicit non-production opt-in", () => {
    const sepoliaConfig = validPaymentConfig({
        network: "base-sepolia",
        allowTestnetPayments: true,
        chainId: 84532,
        rpcUrl: "https://sepolia.base.org",
        tokenAddress: baseSepoliaUsdcAddress
    });

    assert.doesNotThrow(() => validatePaymentConfig(sepoliaConfig, { nodeEnv: "development" }));
    assert.doesNotThrow(() => validatePaymentConfig(sepoliaConfig, { nodeEnv: "test" }));
    assert.doesNotThrow(() => validatePaymentConfig(sepoliaConfig, { nodeEnv: "local" }));
    assert.throws(() => validatePaymentConfig(sepoliaConfig, { nodeEnv: "production" }), /PAYMENT_NETWORK/);
    assert.throws(() => validatePaymentConfig(sepoliaConfig, { nodeEnv: "" }), /NODE_ENV/);
    assert.throws(() => validatePaymentConfig(sepoliaConfig, { nodeEnv: "staging" }), /NODE_ENV/);
    assert.throws(() => validatePaymentConfig({
        ...sepoliaConfig,
        allowTestnetPayments: false
    }, { nodeEnv: "development" }), /ALLOW_TESTNET_PAYMENTS/);
});

test("payment config validation rejects unknown payment network", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ network: "base-goerli" }), { nodeEnv: "development" }), /PAYMENT_NETWORK/);
});

test("payment config validation rejects invalid chain ID", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ chainId: 1 }), baseUsdcAddress), /PAYMENT_CHAIN_ID/);
});

test("payment config validation rejects invalid RPC URL", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ rpcUrl: "not-a-url" }), baseUsdcAddress), /PAYMENT_RPC_URL/);
});

test("payment config validation rejects invalid token address", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ tokenAddress: "0x123" }), baseUsdcAddress), /PAYMENT_TOKEN_ADDRESS/);
});

test("payment config validation rejects non-Base-USDC token address", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ tokenAddress: treasuryAddress }), baseUsdcAddress), /PAYMENT_TOKEN_ADDRESS/);
});

test("payment config validation rejects supported chain and token mismatches", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({
        network: "base-sepolia",
        allowTestnetPayments: true,
        chainId: 84532,
        tokenAddress: baseUsdcAddress
    }), { nodeEnv: "development" }), /PAYMENT_TOKEN_ADDRESS/);
    assert.throws(() => validatePaymentConfig(validPaymentConfig({
        network: "base-mainnet",
        chainId: 8453,
        tokenAddress: baseSepoliaUsdcAddress
    }), { nodeEnv: "development" }), /PAYMENT_TOKEN_ADDRESS/);
    assert.throws(() => validatePaymentConfig(validPaymentConfig({
        network: "base-sepolia",
        allowTestnetPayments: true,
        chainId: 8453,
        tokenAddress: baseSepoliaUsdcAddress
    }), { nodeEnv: "development" }), /PAYMENT_CHAIN_ID/);
});

test("payment config validation accepts explicit BNB Chain methods only from whitelist", () => {
    const bnbConfig = validPaymentConfig({
        methodsJson: JSON.stringify([{
            id: "bnb-mainnet-usdt",
            enabled: true,
            chainId: 56,
            rpcUrl: "https://bsc-dataseed.example.invalid",
            tokenAddress: bnbUsdtAddress,
            tokenSymbol: "USDT",
            tokenDecimals: 18,
            treasuryAddress,
            confirmations: 30
        }]),
        defaultMethodId: "bnb-mainnet-usdt"
    });

    assert.doesNotThrow(() => validatePaymentConfig(bnbConfig, { nodeEnv: "production" }));
    assert.throws(() => validatePaymentConfig({
        ...bnbConfig,
        methodsJson: JSON.stringify([{
            id: "bnb-mainnet-usdt",
            enabled: true,
            chainId: 56,
            rpcUrl: "https://bsc-dataseed.example.invalid",
            tokenAddress: baseUsdcAddress,
            tokenSymbol: "USDT",
            tokenDecimals: 18,
            treasuryAddress,
            confirmations: 30
        }])
    }, { nodeEnv: "production" }), /PAYMENT_METHOD_TOKEN_ADDRESS/);
});

test("payment config validation rejects unknown, disabled, and production testnet payment methods", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({
        methodsJson: JSON.stringify([{
            id: "unknown-usdc",
            enabled: true,
            rpcUrl: "https://example.invalid",
            treasuryAddress
        }])
    }), { nodeEnv: "development" }), /PAYMENT_METHOD_ID/);

    assert.throws(() => validatePaymentConfig(validPaymentConfig({
        methodsJson: JSON.stringify([{
            id: "base-mainnet-usdc",
            enabled: false,
            rpcUrl: "https://base.example.invalid/rpc",
            treasuryAddress
        }])
    }), { nodeEnv: "production" }), /PAYMENT_METHODS_JSON/);

    assert.throws(() => validatePaymentConfig(validPaymentConfig({
        methodsJson: JSON.stringify([{
            id: "base-sepolia-usdc",
            enabled: true,
            chainId: 84532,
            rpcUrl: "https://sepolia.base.org",
            tokenAddress: baseSepoliaUsdcAddress,
            tokenSymbol: "USDC",
            tokenDecimals: 6,
            treasuryAddress,
            confirmations: 12
        }]),
        allowTestnetPayments: true,
        defaultMethodId: "base-sepolia-usdc"
    }), { nodeEnv: "production" }), /PAYMENT_METHOD_ID/);
});

test("payment config validation rejects wrong token decimals", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ tokenDecimals: 18 }), baseUsdcAddress), /PAYMENT_TOKEN_DECIMALS/);
});

test("payment config validation rejects invalid treasury address", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ treasuryAddress: "0xabc" }), baseUsdcAddress), /PAYMENT_TREASURY_ADDRESS/);
});

test("payment config validation rejects invalid confirmations and TTL", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ confirmations: 0 }), baseUsdcAddress), /PAYMENT_CONFIRMATIONS/);
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ intentTtlMinutes: 0 }), baseUsdcAddress), /PAYMENT_INTENT_TTL_MINUTES/);
});

test("payment config validation rejects malformed package JSON and invalid packages", () => {
    assert.throws(() => validatePaymentConfig(validPaymentConfig({ packagesJson: "{" }), baseUsdcAddress), /PAYMENT_PACKAGES_JSON/);
    assert.throws(() => validatePaymentConfig(validPaymentConfig({
        packagesJson: JSON.stringify([
            { packageId: "dup", creditAmount: 1, expectedUsdAmountMinor: 1, expectedTokenAmountBaseUnits: "1" },
            { packageId: "dup", creditAmount: 2, expectedUsdAmountMinor: 2, expectedTokenAmountBaseUnits: "2" }
        ])
    }), baseUsdcAddress), /Duplicate payment packageId/);
    assert.throws(() => parsePaymentPackages(JSON.stringify([
        { packageId: "bad-credit", creditAmount: 0, expectedUsdAmountMinor: 1, expectedTokenAmountBaseUnits: "1" }
    ]), { pricingVersion: "v1" }), /creditAmount/);
    assert.throws(() => parsePaymentPackages(JSON.stringify([
        { packageId: "bad-usd", creditAmount: 1, expectedUsdAmountMinor: 0, expectedTokenAmountBaseUnits: "1" }
    ]), { pricingVersion: "v1" }), /expectedUsdAmountMinor/);
    assert.throws(() => parsePaymentPackages(JSON.stringify([
        { packageId: "bad-token", creditAmount: 1, expectedUsdAmountMinor: 1, expectedTokenAmountBaseUnits: "01" }
    ]), { pricingVersion: "v1" }), /expectedTokenAmountBaseUnits/);
});

test("payment pricing rejects unsafe and invalid financial integers", () => {
    const packageWith = (overrides) => JSON.stringify([
        { packageId: "bad-financial-integer", creditAmount: 1, expectedUsdAmountMinor: 1, expectedTokenAmountBaseUnits: "1", ...overrides }
    ]);

    assert.throws(() => parsePaymentPackages(packageWith({ creditAmount: Number.MAX_SAFE_INTEGER + 1 }), { pricingVersion: "v1" }), /creditAmount/);
    assert.throws(() => parsePaymentPackages(packageWith({ expectedUsdAmountMinor: 9007199254740992 }), { pricingVersion: "v1" }), /expectedUsdAmountMinor/);
    assert.throws(() => parsePaymentPackages(packageWith({ creditAmount: 0 }), { pricingVersion: "v1" }), /creditAmount/);
    assert.throws(() => parsePaymentPackages(packageWith({ expectedUsdAmountMinor: 0 }), { pricingVersion: "v1" }), /expectedUsdAmountMinor/);
    assert.throws(() => parsePaymentPackages(packageWith({ creditAmount: -1 }), { pricingVersion: "v1" }), /creditAmount/);
    assert.throws(() => parsePaymentPackages(packageWith({ expectedUsdAmountMinor: -1 }), { pricingVersion: "v1" }), /expectedUsdAmountMinor/);
    assert.throws(() => parsePaymentPackages(packageWith({ creditAmount: 1.5 }), { pricingVersion: "v1" }), /creditAmount/);
    assert.throws(() => parsePaymentPackages(packageWith({ expectedUsdAmountMinor: 1.5 }), { pricingVersion: "v1" }), /expectedUsdAmountMinor/);
});

test("payment pricing service returns immutable package snapshots", () => {
    const service = createPaymentPricingService({
        packagesJson: validPackagesJson,
        pricingVersion: "pricing-v1"
    });
    const snapshot = service.getPackageSnapshot("starter_credits");

    assert.deepEqual(snapshot, {
        packageId: "starter_credits",
        creditAmount: 750,
        expectedUsdAmountMinor: 500,
        expectedTokenAmountBaseUnits: "5000000",
        pricingVersion: "pricing-v1"
    });
    assert.equal(Object.isFrozen(snapshot), true);
    assert.throws(() => service.getPackageSnapshot("missing"), { code: "INVALID_PAYMENT_PACKAGE" });
});

test("payment pricing preserves canonical token amount strings without floating-point conversion", () => {
    const packages = parsePaymentPackages(JSON.stringify([
        {
            packageId: "precise",
            creditAmount: 1,
            expectedUsdAmountMinor: 1,
            expectedTokenAmountBaseUnits: "123456789012345678901234567890"
        }
    ]), { pricingVersion: "pricing-v1" });

    assert.equal(packages[0].expectedTokenAmountBaseUnits, "123456789012345678901234567890");
});

test("payment payer challenge verifies signature, expiry, and one-time use", async () => {
    const wallet = EthersWallet.createRandom();
    const normalizedAddress = normalizeEvmAddress(wallet.address);
    const userId = new mongoose.Types.ObjectId();
    const now = new Date("2026-08-17T10:00:00.000Z");
    const ChallengeModel = createFakeChallengeModel();
    const service = createPaymentPayerChallengeService({
        ChallengeModel,
        now: () => now,
        randomBytes: () => Buffer.from("123456789012345678901234")
    });

    const { challenge } = await service.createChallenge({ userId, payerAddress: wallet.address });
    assert.equal(challenge.payerAddress, normalizedAddress);
    assert.equal(challenge.message.includes("Bind this wallet as payer for YouTube Bot credit purchase"), true);
    assert.equal(challenge.message.includes(String(userId)), true);

    const signature = await wallet.signMessage(challenge.message);
    const verified = await service.verifyAndUseChallenge({
        userId,
        payerChallengeId: String(challenge._id),
        signature
    });

    assert.equal(verified.payerAddress, normalizedAddress);
    assert.equal(ChallengeModel.challenges.get(String(challenge._id)).usedAt.toISOString(), now.toISOString());
    await assert.rejects(() => service.verifyAndUseChallenge({
        userId,
        payerChallengeId: String(challenge._id),
        signature
    }), { code: "PAYER_CHALLENGE_USED" });

    const otherWallet = EthersWallet.createRandom();
    const expiredAt = new Date("2026-08-17T09:59:59.000Z");
    const expiredChallenge = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        payerAddress: normalizeEvmAddress(otherWallet.address),
        nonce: "expired",
        expiresAt: expiredAt,
        usedAt: null
    };
    expiredChallenge.message = buildChallengeMessage({
        userId,
        payerAddress: expiredChallenge.payerAddress,
        nonce: expiredChallenge.nonce,
        expiresAt: expiredChallenge.expiresAt
    });
    ChallengeModel.challenges.set(String(expiredChallenge._id), expiredChallenge);
    const expiredSignature = await otherWallet.signMessage(expiredChallenge.message);
    await assert.rejects(() => service.verifyAndUseChallenge({
        userId,
        payerChallengeId: String(expiredChallenge._id),
        signature: expiredSignature
    }), { code: "PAYER_CHALLENGE_EXPIRED" });

    const invalidChallenge = {
        _id: new mongoose.Types.ObjectId(),
        userId,
        payerAddress: normalizedAddress,
        nonce: "invalid",
        expiresAt: new Date("2026-08-17T10:05:00.000Z"),
        usedAt: null
    };
    invalidChallenge.message = buildChallengeMessage({
        userId,
        payerAddress: invalidChallenge.payerAddress,
        nonce: invalidChallenge.nonce,
        expiresAt: invalidChallenge.expiresAt
    });
    ChallengeModel.challenges.set(String(invalidChallenge._id), invalidChallenge);
    const invalidSignature = await otherWallet.signMessage(invalidChallenge.message);
    await assert.rejects(() => service.verifyAndUseChallenge({
        userId,
        payerChallengeId: String(invalidChallenge._id),
        signature: invalidSignature
    }), { code: "INVALID_PAYER_SIGNATURE" });
});

test("payment intent creation stores backend-owned immutable snapshot and expiration", async () => {
    const PaymentIntentModel = createFakePaymentIntentModel();
    const pricingService = createPaymentPricingService({
        packagesJson: validPackagesJson,
        pricingVersion: "pricing-v1"
    });
    const service = createPaymentIntentService({
        PaymentIntentModel,
        pricingService,
        payerChallengeService: createFakePayerChallengeService(),
        config: validPaymentConfig({ pricingVersion: "pricing-v1" }),
        now: () => new Date("2026-08-17T10:00:00.000Z")
    });

    const result = await service.createPaymentIntent({
        userId: "64b000000000000000000000",
        packageId: "starter_credits",
        paymentMethodId: "base-mainnet-usdc",
        idempotencyKey: "idem-1",
        payerChallengeId: String(payerChallengeId),
        signature: validSignature
    });

    assert.equal(result.created, true);
    assert.equal(result.intent.status, "PENDING");
    assert.equal(result.intent.paymentMethodId, "base-mainnet-usdc");
    assert.equal(result.intent.paymentMethodSnapshot.id, "base-mainnet-usdc");
    assert.equal(result.intent.paymentMethodSnapshot.tokenSymbol, "USDC");
    assert.equal(result.intent.chainId, 8453);
    assert.equal(result.intent.tokenAddress, baseUsdcAddress);
    assert.equal(result.intent.tokenDecimals, 6);
    assert.equal(result.intent.recipientAddress, treasuryAddress);
    assert.equal(result.intent.creditAmount, 750);
    assert.equal(result.intent.payerAddress, payerAddress);
    assert.equal(String(result.intent.payerChallengeId), String(payerChallengeId));
    assert.equal(result.intent.expectedUsdAmountMinor, 500);
    assert.equal(result.intent.expectedTokenAmountBaseUnits, "5000000");
    assert.equal(result.intent.pricingVersion, "pricing-v1");
    assert.equal(result.intent.expiresAt.toISOString(), "2026-08-17T10:30:00.000Z");
});

test("payment intent creation rejects invalid payer proof before creating intent", async () => {
    const PaymentIntentModel = createFakePaymentIntentModel();
    const pricingService = createPaymentPricingService({
        packagesJson: validPackagesJson,
        pricingVersion: "pricing-v1"
    });
    const service = createPaymentIntentService({
        PaymentIntentModel,
        pricingService,
        payerChallengeService: {
            async verifyAndUseChallenge() {
                const error = new Error("invalid signature");
                error.code = "INVALID_PAYER_SIGNATURE";
                throw error;
            }
        },
        config: validPaymentConfig({ pricingVersion: "pricing-v1" }),
        now: () => new Date("2026-08-17T10:00:00.000Z")
    });

    await assert.rejects(() => service.createPaymentIntent({
        userId: "64b000000000000000000000",
        packageId: "starter_credits",
        paymentMethodId: "base-mainnet-usdc",
        idempotencyKey: "idem-1",
        payerChallengeId: String(payerChallengeId),
        signature: validSignature
    }), { code: "INVALID_PAYER_SIGNATURE" });
    assert.equal(PaymentIntentModel.intents.length, 0);
});

test("payment intent creation rejects invalid or disabled payment method", async () => {
    const PaymentIntentModel = createFakePaymentIntentModel();
    const pricingService = createPaymentPricingService({
        packagesJson: validPackagesJson,
        pricingVersion: "pricing-v1"
    });
    const service = createPaymentIntentService({
        PaymentIntentModel,
        pricingService,
        payerChallengeService: createFakePayerChallengeService(),
        config: validPaymentConfig({
            pricingVersion: "pricing-v1",
            methodsJson: JSON.stringify([{
                id: "base-mainnet-usdc",
                enabled: false,
                rpcUrl: "https://base.example.invalid/rpc",
                treasuryAddress
            }])
        }),
        now: () => new Date("2026-08-17T10:00:00.000Z")
    });

    await assert.rejects(() => service.createPaymentIntent({
        userId: "64b000000000000000000000",
        packageId: "starter_credits",
        paymentMethodId: "base-mainnet-usdc",
        idempotencyKey: "idem-1",
        payerChallengeId: String(payerChallengeId),
        signature: validSignature
    }), { code: "PAYMENT_METHOD_UNAVAILABLE" });

    await assert.rejects(() => service.createPaymentIntent({
        userId: "64b000000000000000000000",
        packageId: "starter_credits",
        paymentMethodId: "base-sepolia-usdc",
        idempotencyKey: "idem-2",
        payerChallengeId: String(payerChallengeId),
        signature: validSignature
    }), { code: "PAYMENT_METHOD_UNAVAILABLE" });
    assert.equal(PaymentIntentModel.intents.length, 0);
});

test("payment intent creation is idempotent by user and idempotency key", async () => {
    const PaymentIntentModel = createFakePaymentIntentModel();
    const pricingService = createPaymentPricingService({
        packagesJson: validPackagesJson,
        pricingVersion: "pricing-v1"
    });
    const service = createPaymentIntentService({
        PaymentIntentModel,
        pricingService,
        payerChallengeService: createFakePayerChallengeService(),
        config: validPaymentConfig({ pricingVersion: "pricing-v1" }),
        now: () => new Date("2026-08-17T10:00:00.000Z")
    });

    const first = await service.createPaymentIntent({ userId: "user-1", packageId: "starter_credits", paymentMethodId: "base-mainnet-usdc", idempotencyKey: "same-key", payerChallengeId: String(payerChallengeId), signature: validSignature });
    const duplicate = await service.createPaymentIntent({ userId: "user-1", packageId: "growth_credits", idempotencyKey: "same-key" });
    const differentKey = await service.createPaymentIntent({ userId: "user-1", packageId: "growth_credits", paymentMethodId: "base-mainnet-usdc", idempotencyKey: "other-key", payerChallengeId: String(new mongoose.Types.ObjectId()), signature: validSignature });
    const differentUser = await service.createPaymentIntent({ userId: "user-2", packageId: "starter_credits", paymentMethodId: "base-mainnet-usdc", idempotencyKey: "same-key", payerChallengeId: String(new mongoose.Types.ObjectId()), signature: validSignature });

    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.intent._id, first.intent._id);
    assert.equal(differentKey.created, true);
    assert.equal(differentUser.created, true);
    assert.equal(PaymentIntentModel.intents.length, 3);
});

test("payment intent snapshot is not mutated by later pricing service changes", async () => {
    const PaymentIntentModel = createFakePaymentIntentModel();
    const serviceV1 = createPaymentIntentService({
        PaymentIntentModel,
        pricingService: createPaymentPricingService({ packagesJson: validPackagesJson, pricingVersion: "pricing-v1" }),
        payerChallengeService: createFakePayerChallengeService(),
        config: validPaymentConfig({ pricingVersion: "pricing-v1" }),
        now: () => new Date("2026-08-17T10:00:00.000Z")
    });
    const first = await serviceV1.createPaymentIntent({ userId: "user-1", packageId: "starter_credits", paymentMethodId: "base-mainnet-usdc", idempotencyKey: "idem-1", payerChallengeId: String(payerChallengeId), signature: validSignature });

    const serviceV2 = createPaymentIntentService({
        PaymentIntentModel,
        pricingService: createPaymentPricingService({
            packagesJson: JSON.stringify([
                { packageId: "starter_credits", creditAmount: 9999, expectedUsdAmountMinor: 9999, expectedTokenAmountBaseUnits: "99990000" }
            ]),
            pricingVersion: "pricing-v2"
        }),
        payerChallengeService: createFakePayerChallengeService(),
        config: validPaymentConfig({ pricingVersion: "pricing-v2" }),
        now: () => new Date("2026-08-17T11:00:00.000Z")
    });
    const second = await serviceV2.createPaymentIntent({ userId: "user-1", packageId: "starter_credits", paymentMethodId: "base-mainnet-usdc", idempotencyKey: "idem-2", payerChallengeId: String(new mongoose.Types.ObjectId()), signature: validSignature });

    assert.equal(first.intent.creditAmount, 750);
    assert.equal(first.intent.expectedTokenAmountBaseUnits, "5000000");
    assert.equal(first.intent.pricingVersion, "pricing-v1");
    assert.equal(second.intent.creditAmount, 9999);
    assert.equal(second.intent.pricingVersion, "pricing-v2");
});

test("PaymentIntent schema has required states, immutability, validation, and indexes", async () => {
    const states = PaymentIntent.schema.path("status").enumValues;
    assert.deepEqual(states, [
        "PENDING",
        "SUBMITTED",
        "VERIFYING",
        "CONFIRMING",
        "CONFIRMED",
        "CONFIRMED_OVERPAID",
        "UNDERPAID",
        "MANUAL_REVIEW_REQUIRED",
        "EXPIRED",
        "FAILED",
        "REJECTED",
        "CANCELLED"
    ]);

    assert.equal(PaymentIntent.schema.path("paymentMethodId").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("paymentMethodSnapshot.id").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("paymentMethodSnapshot.tokenAddress").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("chainId").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("expectedTokenAmountBaseUnits").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("creditAmount").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("payerAddress").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("payerChallengeId").options.immutable, true);
    assert(PaymentIntent.schema.path("candidateTxHash"));

    const intent = new PaymentIntent(validPaymentIntentDocument());
    await intent.validate();
    assert.equal(intent.status, "PENDING");

    intent.status = "INVALID";
    await assert.rejects(() => intent.validate(), /`INVALID` is not a valid enum value/);

    const indexes = PaymentIntent.schema.indexes();
    assert(indexes.some(([fields, options]) => fields.userId === 1 && fields.idempotencyKey === 1 && options.unique === true));
    assert(indexes.some(([fields]) => fields.userId === 1 && fields.payerAddress === 1 && fields.createdAt === -1));
    assert(indexes.some(([fields, options]) => fields.chainId === 1 && fields.txHash === 1 && options.unique === true && options.partialFilterExpression?.txHash?.$type === "string"));
    assert(indexes.some(([fields]) => fields.paymentMethodId === 1 && fields.createdAt === -1));
    assert(indexes.some(([fields]) => fields.userId === 1 && fields.createdAt === -1));
    assert(indexes.some(([fields]) => fields.status === 1 && fields.updatedAt === 1));
    assert(indexes.some(([fields]) => fields.status === 1 && fields.expiresAt === 1));
});

test("PaymentIntent schema rejects unsafe and invalid financial integers", async () => {
    const assertInvalidFinancialInteger = async (field, value) => {
        const intent = new PaymentIntent(validPaymentIntentDocument({ [field]: value }));
        await assert.rejects(() => intent.validate(), new RegExp(field));
    };

    await assertInvalidFinancialInteger("creditAmount", Number.MAX_SAFE_INTEGER + 1);
    await assertInvalidFinancialInteger("expectedUsdAmountMinor", 9007199254740992);
    await assertInvalidFinancialInteger("creditAmount", 0);
    await assertInvalidFinancialInteger("expectedUsdAmountMinor", 0);
    await assertInvalidFinancialInteger("creditAmount", -1);
    await assertInvalidFinancialInteger("expectedUsdAmountMinor", -1);
    await assertInvalidFinancialInteger("creditAmount", 1.5);
    await assertInvalidFinancialInteger("expectedUsdAmountMinor", 1.5);
});
