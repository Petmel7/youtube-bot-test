const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { createPaymentConfigService, CONFIRMATION_PHRASE } = require("../src/services/payments/paymentConfigService");
const { createPaymentIntentService } = require("../src/services/billing/paymentIntentService");
const { createPaymentPricingService } = require("../src/services/billing/paymentPricingService");

const adminA = "64d000000000000000000001";
const adminB = "64d000000000000000000002";
const treasuryAddress = "0x1111111111111111111111111111111111111111";
const newTreasuryAddress = "0x2222222222222222222222222222222222222222";
const payerAddress = "0x3333333333333333333333333333333333333333";
const payerChallengeId = new mongoose.Types.ObjectId();
const validSignature = `0x${"a".repeat(130)}`;
const runInlineTransaction = async (callback) => callback({ testSession: true });

const envConfig = (overrides = {}) => ({
    network: "base-mainnet",
    allowTestnetPayments: false,
    chainId: 8453,
    rpcUrl: "https://base.example.invalid/rpc",
    tokenAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    treasuryAddress,
    confirmations: 60,
    verifyThrottleWindowMs: 60000,
    verifyThrottleMax: 10,
    intentTtlMinutes: 30,
    pricingVersion: "pricing-v1",
    packagesJson: JSON.stringify([{ packageId: "starter_credits", creditAmount: 750, expectedUsdAmountMinor: 500 }]),
    methodsJson: JSON.stringify([{
        id: "base-mainnet-usdc",
        enabled: true,
        rpcUrl: "https://secret-rpc.example.invalid/key",
        treasuryAddress,
        confirmations: 20
    }]),
    defaultMethodId: "base-mainnet-usdc",
    ...overrides
});

const clone = (value) => value ? JSON.parse(JSON.stringify(value)) : null;

const makeQuery = (value) => ({
    sort() { return this; },
    limit() { return this; },
    lean() { return Promise.resolve(clone(value)); },
    then(resolve, reject) { return Promise.resolve(clone(value)).then(resolve, reject); }
});

const createProposalModel = () => {
    const docs = new Map();
    let counter = 1;
    class ProposalDoc {
        constructor(entry) {
            Object.assign(this, entry);
        }
        async save() {
            this.updatedAt = new Date("2026-08-18T10:10:00.000Z");
            docs.set(String(this._id), this);
            return this;
        }
    }
    return {
        docs,
        async create(entries) {
            return entries.map((entry) => {
                const id = `65e00000000000000000000${counter}`;
                counter += 1;
                const doc = new ProposalDoc({
                    _id: id,
                    createdAt: new Date("2026-08-18T10:00:00.000Z"),
                    updatedAt: new Date("2026-08-18T10:00:00.000Z"),
                    ...entry
                });
                docs.set(String(doc._id), doc);
                return doc;
            });
        },
        findById(id) {
            const doc = docs.get(String(id)) || null;
            return {
                then(resolve, reject) {
                    return Promise.resolve(doc).then(resolve, reject);
                }
            };
        },
        find(filter = {}) {
            const values = [...docs.values()].filter(doc => !filter.status || doc.status === filter.status);
            return makeQuery(values);
        }
    };
};

const createActiveModel = () => {
    const docs = [];
    return {
        docs,
        async create(entries) {
            const created = entries.map((entry, index) => ({
                _id: `66e00000000000000000000${docs.length + index}`,
                createdAt: new Date("2026-08-18T10:20:00.000Z"),
                ...entry
            }));
            docs.push(...created);
            return created;
        },
        findOne() {
            const latest = docs.toSorted((left, right) => right.version - left.version)[0] || null;
            return makeQuery(latest);
        }
    };
};

const createAuditModel = () => {
    const entries = [];
    return {
        entries,
        async create(docs) {
            const created = docs.map((entry, index) => ({
                _id: `67e00000000000000000000${entries.length + index}`,
                createdAt: new Date("2026-08-18T10:05:00.000Z"),
                ...clone(entry)
            }));
            entries.push(...created);
            return created;
        },
        find(filter = {}) {
            return makeQuery(entries.filter(entry => !filter.proposalId || String(entry.proposalId) === String(filter.proposalId)));
        }
    };
};

const createFakePaymentIntentModel = () => {
    const intents = [];
    return {
        intents,
        findOne() {
            return makeQuery(null);
        },
        async create(entries) {
            const created = entries.map((entry, index) => ({
                _id: `68e00000000000000000000${intents.length + index}`,
                ...clone(entry)
            }));
            intents.push(...created);
            return created;
        }
    };
};

test("payment config proposal validates whitelist identity and safe diff", async () => {
    const ProposalModel = createProposalModel();
    const ActiveModel = createActiveModel();
    const AuditModel = createAuditModel();
    const service = createPaymentConfigService({
        PaymentConfigProposalModel: ProposalModel,
        PaymentConfigActiveModel: ActiveModel,
        PaymentConfigAuditLogModel: AuditModel,
        envConfig: envConfig(),
        nodeEnv: "production",
        now: () => new Date("2026-08-18T10:00:00.000Z"),
        withTransaction: runInlineTransaction
    });

    const proposal = await service.createProposal({
        actorUserId: adminA,
        reason: "Rotate treasury for operations",
        methodChanges: [{
            methodId: "base-mainnet-usdc",
            treasuryAddress: newTreasuryAddress,
            confirmations: 25
        }]
    });

    assert.equal(proposal.status, "PENDING_CONFIRMATION");
    assert.equal(proposal.normalizedPreview.diff[0].before.treasuryAddress, treasuryAddress);
    assert.equal(proposal.normalizedPreview.diff[0].after.treasuryAddress, newTreasuryAddress);
    assert.equal(proposal.normalizedPreview.methods[0].tokenAddress, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
    assert.equal(proposal.normalizedPreview.methods[0].rpcUrl, undefined);
    assert.equal(AuditModel.entries[0].action, "CREATE_PROPOSAL");
    assert.equal(AuditModel.entries[0].metadata.diff[0].after.treasuryAddress, newTreasuryAddress);

    await assert.rejects(() => service.createProposal({
        actorUserId: adminA,
        reason: "Bad method",
        methodChanges: [{ methodId: "unknown-usdc", enabled: true }]
    }), { code: "INVALID_PAYMENT_METHOD" });

    await assert.rejects(() => service.createProposal({
        actorUserId: adminA,
        reason: "Bad identity",
        methodChanges: [{ methodId: "base-mainnet-usdc", tokenAddress: newTreasuryAddress }]
    }), { code: "PAYMENT_CONFIG_IDENTITY_IMMUTABLE" });

    await assert.rejects(() => service.createProposal({
        actorUserId: adminA,
        reason: "Bad treasury",
        methodChanges: [{ methodId: "base-mainnet-usdc", treasuryAddress: "0xabc" }]
    }), { code: "INVALID_PAYMENT_CONFIG_TREASURY" });
});

test("payment config proposal confirmation and production dual approval are enforced", async () => {
    const ProposalModel = createProposalModel();
    const ActiveModel = createActiveModel();
    const AuditModel = createAuditModel();
    const service = createPaymentConfigService({
        PaymentConfigProposalModel: ProposalModel,
        PaymentConfigActiveModel: ActiveModel,
        PaymentConfigAuditLogModel: AuditModel,
        envConfig: envConfig(),
        nodeEnv: "production",
        now: () => new Date("2026-08-18T10:00:00.000Z"),
        withTransaction: runInlineTransaction
    });
    const proposal = await service.createProposal({
        actorUserId: adminA,
        reason: "Change confirmations",
        methodChanges: [{ methodId: "base-mainnet-usdc", confirmations: 30 }]
    });

    await assert.rejects(() => service.confirmProposal({
        proposalId: proposal._id,
        actorUserId: adminA,
        confirmationPhrase: "yes"
    }), { code: "INVALID_PAYMENT_CONFIG_CONFIRMATION" });

    const confirmed = await service.confirmProposal({
        proposalId: proposal._id,
        actorUserId: adminA,
        confirmationPhrase: CONFIRMATION_PHRASE
    });
    assert.equal(confirmed.status, "PENDING_APPROVAL");

    await assert.rejects(() => service.approveProposal({
        proposalId: proposal._id,
        actorUserId: adminA
    }), { code: "PAYMENT_CONFIG_DUAL_APPROVAL_REQUIRED" });

    const approved = await service.approveProposal({
        proposalId: proposal._id,
        actorUserId: adminB
    });
    assert.equal(approved.status, "APPROVED");
    assert.deepEqual(AuditModel.entries.map(entry => entry.action), [
        "CREATE_PROPOSAL",
        "CONFIRM_PROPOSAL",
        "APPROVE_PROPOSAL"
    ]);
});

test("payment config activation writes active config and affects future PaymentIntents only", async () => {
    const ProposalModel = createProposalModel();
    const ActiveModel = createActiveModel();
    const AuditModel = createAuditModel();
    const configService = createPaymentConfigService({
        PaymentConfigProposalModel: ProposalModel,
        PaymentConfigActiveModel: ActiveModel,
        PaymentConfigAuditLogModel: AuditModel,
        envConfig: envConfig(),
        nodeEnv: "development",
        now: () => new Date("2026-08-18T10:00:00.000Z"),
        withTransaction: runInlineTransaction
    });
    const proposal = await configService.createProposal({
        actorUserId: adminA,
        reason: "Change future treasury",
        methodChanges: [{ methodId: "base-mainnet-usdc", treasuryAddress: newTreasuryAddress }]
    });
    await configService.confirmProposal({
        proposalId: proposal._id,
        actorUserId: adminA,
        confirmationPhrase: CONFIRMATION_PHRASE
    });
    const { active } = await configService.activateProposal({ proposalId: proposal._id, actorUserId: adminA });

    assert.equal(active.version, 1);
    assert.equal(active.methods[0].treasuryAddress, newTreasuryAddress);
    assert.equal(AuditModel.entries.at(-1).action, "ACTIVATE_PROPOSAL");
    assert.equal(AuditModel.entries.at(-1).metadata.diff[0].after.treasuryAddress, newTreasuryAddress);

    const existingIntentSnapshot = { recipientAddress: treasuryAddress };
    const PaymentIntentModel = createFakePaymentIntentModel();
    const intentService = createPaymentIntentService({
        PaymentIntentModel,
        pricingService: createPaymentPricingService({
            packagesJson: envConfig().packagesJson,
            pricingVersion: "pricing-v1"
        }),
        payerChallengeService: {
            async verifyAndUseChallenge() {
                return { payerAddress, challenge: { _id: payerChallengeId, namespace: "eip155" } };
            }
        },
        config: envConfig(),
        configService,
        now: () => new Date("2026-08-18T11:00:00.000Z")
    });
    const created = await intentService.createPaymentIntent({
        userId: "64b000000000000000000000",
        packageId: "starter_credits",
        paymentMethodId: "base-mainnet-usdc",
        idempotencyKey: "idem-future-config",
        payerChallengeId: String(payerChallengeId),
        signature: validSignature
    });

    assert.equal(existingIntentSnapshot.recipientAddress, treasuryAddress);
    assert.equal(created.intent.recipientAddress, newTreasuryAddress);
    assert.equal(created.intent.paymentMethodSnapshot.treasuryAddress, newTreasuryAddress);
});

test("rejected or cancelled proposals cannot activate", async () => {
    const ProposalModel = createProposalModel();
    const ActiveModel = createActiveModel();
    const AuditModel = createAuditModel();
    const service = createPaymentConfigService({
        PaymentConfigProposalModel: ProposalModel,
        PaymentConfigActiveModel: ActiveModel,
        PaymentConfigAuditLogModel: AuditModel,
        envConfig: envConfig(),
        nodeEnv: "development",
        now: () => new Date("2026-08-18T10:00:00.000Z"),
        withTransaction: runInlineTransaction
    });
    const proposal = await service.createProposal({
        actorUserId: adminA,
        reason: "Disable method",
        methodChanges: [{ methodId: "base-mainnet-usdc", confirmations: 21 }]
    });
    await service.rejectProposal({ proposalId: proposal._id, actorUserId: adminB, note: "Not needed" });

    await assert.rejects(() => service.activateProposal({ proposalId: proposal._id, actorUserId: adminA }), {
        code: "PAYMENT_CONFIG_PROPOSAL_NOT_ACTIVATABLE"
    });
});
