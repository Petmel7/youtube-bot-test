const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const PaymentIntent = require("../src/models/PaymentIntent");
const { normalizeEvmAddress } = require("../src/utils/evmAddress");
const { validatePaymentConfig } = require("../src/config/validateEnv");
const {
    createPaymentPricingService,
    parsePaymentPackages
} = require("../src/services/billing/paymentPricingService");
const { createPaymentIntentService } = require("../src/services/billing/paymentIntentService");

const baseUsdcAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const treasuryAddress = "0x1111111111111111111111111111111111111111";
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
    chainId: 8453,
    rpcUrl: "https://base.example.invalid/rpc",
    tokenAddress: baseUsdcAddress,
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    treasuryAddress,
    confirmations: 60,
    intentTtlMinutes: 30,
    pricingVersion: "phase3a-test-v1",
    packagesJson: validPackagesJson,
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

test("payment config validation accepts valid Base USDC config", () => {
    assert.doesNotThrow(() => validatePaymentConfig(validPaymentConfig(), baseUsdcAddress));
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

test("payment intent creation stores backend-owned immutable snapshot and expiration", async () => {
    const PaymentIntentModel = createFakePaymentIntentModel();
    const pricingService = createPaymentPricingService({
        packagesJson: validPackagesJson,
        pricingVersion: "pricing-v1"
    });
    const service = createPaymentIntentService({
        PaymentIntentModel,
        pricingService,
        config: validPaymentConfig({ pricingVersion: "pricing-v1" }),
        now: () => new Date("2026-08-17T10:00:00.000Z")
    });

    const result = await service.createPaymentIntent({
        userId: "64b000000000000000000000",
        packageId: "starter_credits",
        idempotencyKey: "idem-1"
    });

    assert.equal(result.created, true);
    assert.equal(result.intent.status, "PENDING");
    assert.equal(result.intent.chainId, 8453);
    assert.equal(result.intent.tokenAddress, baseUsdcAddress);
    assert.equal(result.intent.tokenDecimals, 6);
    assert.equal(result.intent.recipientAddress, treasuryAddress);
    assert.equal(result.intent.creditAmount, 750);
    assert.equal(result.intent.expectedUsdAmountMinor, 500);
    assert.equal(result.intent.expectedTokenAmountBaseUnits, "5000000");
    assert.equal(result.intent.pricingVersion, "pricing-v1");
    assert.equal(result.intent.expiresAt.toISOString(), "2026-08-17T10:30:00.000Z");
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
        config: validPaymentConfig({ pricingVersion: "pricing-v1" }),
        now: () => new Date("2026-08-17T10:00:00.000Z")
    });

    const first = await service.createPaymentIntent({ userId: "user-1", packageId: "starter_credits", idempotencyKey: "same-key" });
    const duplicate = await service.createPaymentIntent({ userId: "user-1", packageId: "growth_credits", idempotencyKey: "same-key" });
    const differentKey = await service.createPaymentIntent({ userId: "user-1", packageId: "growth_credits", idempotencyKey: "other-key" });
    const differentUser = await service.createPaymentIntent({ userId: "user-2", packageId: "starter_credits", idempotencyKey: "same-key" });

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
        config: validPaymentConfig({ pricingVersion: "pricing-v1" }),
        now: () => new Date("2026-08-17T10:00:00.000Z")
    });
    const first = await serviceV1.createPaymentIntent({ userId: "user-1", packageId: "starter_credits", idempotencyKey: "idem-1" });

    const serviceV2 = createPaymentIntentService({
        PaymentIntentModel,
        pricingService: createPaymentPricingService({
            packagesJson: JSON.stringify([
                { packageId: "starter_credits", creditAmount: 9999, expectedUsdAmountMinor: 9999, expectedTokenAmountBaseUnits: "99990000" }
            ]),
            pricingVersion: "pricing-v2"
        }),
        config: validPaymentConfig({ pricingVersion: "pricing-v2" }),
        now: () => new Date("2026-08-17T11:00:00.000Z")
    });
    const second = await serviceV2.createPaymentIntent({ userId: "user-1", packageId: "starter_credits", idempotencyKey: "idem-2" });

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
        "EXPIRED",
        "FAILED",
        "REJECTED",
        "CANCELLED"
    ]);

    assert.equal(PaymentIntent.schema.path("chainId").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("expectedTokenAmountBaseUnits").options.immutable, true);
    assert.equal(PaymentIntent.schema.path("creditAmount").options.immutable, true);

    const intent = new PaymentIntent({
        userId: new mongoose.Types.ObjectId(),
        idempotencyKey: "idem-1",
        packageId: "starter_credits",
        chainId: 8453,
        tokenAddress: normalizeEvmAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        recipientAddress: treasuryAddress,
        expectedTokenAmountBaseUnits: "5000000",
        expectedUsdAmountMinor: 500,
        creditAmount: 750,
        pricingVersion: "pricing-v1",
        expiresAt: new Date("2026-08-17T10:30:00.000Z")
    });
    await intent.validate();
    assert.equal(intent.status, "PENDING");

    intent.status = "INVALID";
    await assert.rejects(() => intent.validate(), /`INVALID` is not a valid enum value/);

    const indexes = PaymentIntent.schema.indexes();
    assert(indexes.some(([fields, options]) => fields.userId === 1 && fields.idempotencyKey === 1 && options.unique === true));
    assert(indexes.some(([fields, options]) => fields.chainId === 1 && fields.txHash === 1 && options.unique === true && options.partialFilterExpression?.txHash?.$type === "string"));
    assert(indexes.some(([fields]) => fields.userId === 1 && fields.createdAt === -1));
    assert(indexes.some(([fields]) => fields.status === 1 && fields.updatedAt === 1));
    assert(indexes.some(([fields]) => fields.status === 1 && fields.expiresAt === 1));
});
