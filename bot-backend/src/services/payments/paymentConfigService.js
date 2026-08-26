const mongoose = require("mongoose");
const PaymentConfigActive = require("../../models/PaymentConfigActive");
const PaymentConfigProposal = require("../../models/PaymentConfigProposal");
const PaymentConfigAuditLog = require("../../models/PaymentConfigAuditLog");
const { paymentConfig } = require("../../config/config");
const { buildPaymentMethods } = require("../../config/paymentMethods");
const { getAllowedPaymentMethod } = require("../../config/paymentNetworks");
const { validatePaymentConfig } = require("../../config/validateEnv");
const { isValidEvmAddress, normalizeEvmAddress } = require("../../utils/evmAddress");
const { isValidSolanaPublicKey } = require("../../utils/solana");
const { badRequest, conflict, notFound } = require("../../utils/errors");

const CONFIRMATION_PHRASE = "CONFIRM PAYMENT CONFIG CHANGE";
const PROPOSAL_TTL_HOURS = 24;
const MAX_CONFIRMATIONS = 500;

const runMongoTransaction = async (callback) => {
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => {
            result = await callback(session);
        });
        return result;
    } finally {
        await session.endSession();
    }
};

const cloneConfig = (config) => ({ ...config });

const normalizeReason = (reason) => {
    if (typeof reason !== "string" || !reason.trim()) {
        throw badRequest("INVALID_PAYMENT_CONFIG_REASON", "Proposal reason is required");
    }
    const trimmed = reason.trim();
    if (trimmed.length > 1000) {
        throw badRequest("INVALID_PAYMENT_CONFIG_REASON", "Proposal reason is too long");
    }
    return trimmed;
};

const normalizeNote = (note) => {
    if (note === undefined || note === null) return null;
    if (typeof note !== "string") {
        throw badRequest("INVALID_PAYMENT_CONFIG_NOTE", "Proposal note must be a string");
    }
    const trimmed = note.trim();
    if (trimmed.length > 1000) {
        throw badRequest("INVALID_PAYMENT_CONFIG_NOTE", "Proposal note is too long");
    }
    return trimmed || null;
};

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const methodIdentityFields = new Set([
    "namespace",
    "network",
    "networkId",
    "caipNetworkId",
    "chainId",
    "tokenAddress",
    "mintAddress",
    "tokenSymbol",
    "tokenDecimals",
    "assetType",
    "assetProvenance",
    "rpcUrl"
]);

const summarizeMethod = (method) => ({
    id: method.id,
    name: method.name,
    namespace: method.namespace || "eip155",
    network: method.network,
    networkId: method.networkId || null,
    caipNetworkId: method.caipNetworkId || ((method.namespace || "eip155") === "solana" ? `solana:${method.networkId}` : `eip155:${method.chainId}`),
    chainId: method.chainId ?? null,
    cluster: method.cluster || null,
    assetType: method.assetType || "erc20",
    assetProvenance: method.assetProvenance || null,
    tokenSymbol: method.tokenSymbol,
    tokenDecimals: method.tokenDecimals,
    tokenAddress: method.tokenAddress || null,
    mintAddress: method.mintAddress || null,
    treasuryAddress: method.treasuryAddress,
    confirmations: method.confirmations,
    enabled: method.enabled === true,
    production: method.production === true,
    testnet: method.testnet === true || method.production === false,
    smoke: method.smoke === true
});

const methodConfigForValidation = (method) => ({
    id: method.id,
    enabled: method.enabled === true,
    namespace: method.namespace || "eip155",
    networkId: method.networkId,
    caipNetworkId: method.caipNetworkId,
    cluster: method.cluster,
    chainId: method.chainId,
    rpcUrl: method.rpcUrl,
    assetType: method.assetType,
    tokenAddress: method.tokenAddress,
    mintAddress: method.mintAddress,
    tokenSymbol: method.tokenSymbol,
    tokenDecimals: method.tokenDecimals,
    assetProvenance: method.assetProvenance,
    treasuryAddress: method.treasuryAddress,
    confirmations: method.confirmations
});

const buildMethodsJson = (methods) => JSON.stringify(methods.map(methodConfigForValidation));

const withSession = (query, session) => {
    if (session && query && typeof query.session === "function") {
        return query.session(session);
    }
    return query;
};

const safeDiffForMethod = (before, after) => {
    const diff = { methodId: after.id, before: {}, after: {} };
    ["enabled", "treasuryAddress", "confirmations"].forEach((field) => {
        if (before?.[field] !== after?.[field]) {
            diff.before[field] = before?.[field];
            diff.after[field] = after?.[field];
        }
    });
    return Object.keys(diff.after).length > 0 ? diff : null;
};

const sanitizeMethodChange = (change) => {
    if (!isObject(change)) {
        throw badRequest("INVALID_PAYMENT_CONFIG_CHANGE", "Method change must be an object");
    }

    const methodId = typeof change.methodId === "string" ? change.methodId.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(methodId)) {
        throw badRequest("INVALID_PAYMENT_METHOD", "Invalid payment method");
    }

    for (const key of Object.keys(change)) {
        if (key !== "methodId" && key !== "enabled" && key !== "treasuryAddress" && key !== "confirmations") {
            if (methodIdentityFields.has(key)) {
                throw badRequest("PAYMENT_CONFIG_IDENTITY_IMMUTABLE", "Payment method identity cannot be changed");
            }
            throw badRequest("INVALID_PAYMENT_CONFIG_CHANGE", "Unsupported payment config change");
        }
    }

    const sanitized = { methodId };
    if (Object.prototype.hasOwnProperty.call(change, "enabled")) {
        if (typeof change.enabled !== "boolean") {
            throw badRequest("INVALID_PAYMENT_CONFIG_ENABLED", "enabled must be boolean");
        }
        sanitized.enabled = change.enabled;
    }

    if (Object.prototype.hasOwnProperty.call(change, "treasuryAddress")) {
        if (typeof change.treasuryAddress !== "string" || !change.treasuryAddress.trim()) {
            throw badRequest("INVALID_PAYMENT_CONFIG_TREASURY", "Invalid treasury address");
        }
        sanitized.treasuryAddress = change.treasuryAddress.trim();
    }

    if (Object.prototype.hasOwnProperty.call(change, "confirmations")) {
        const confirmations = Number(change.confirmations);
        if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > MAX_CONFIRMATIONS) {
            throw badRequest("INVALID_PAYMENT_CONFIG_CONFIRMATIONS", "Invalid payment confirmations");
        }
        sanitized.confirmations = confirmations;
    }

    if (!Object.prototype.hasOwnProperty.call(sanitized, "enabled") &&
        !Object.prototype.hasOwnProperty.call(sanitized, "treasuryAddress") &&
        !Object.prototype.hasOwnProperty.call(sanitized, "confirmations")) {
        throw badRequest("INVALID_PAYMENT_CONFIG_CHANGE", "No supported payment config changes were provided");
    }

    return sanitized;
};

const activeMethodOverridesToConfig = ({ envConfig, activeConfig }) => {
    const envMethods = buildPaymentMethods(envConfig);
    const envById = new Map(envMethods.map(method => [method.id, method]));
    const mergedMethods = activeConfig.methods.map((activeMethod) => {
        const envMethod = envById.get(activeMethod.id);
        if (!envMethod) {
            throw conflict("PAYMENT_CONFIG_ENV_METHOD_MISSING", "Activated payment method is missing from environment config");
        }

        return {
            ...envMethod,
            enabled: activeMethod.enabled,
            treasuryAddress: activeMethod.treasuryAddress,
            confirmations: activeMethod.confirmations
        };
    });

    return {
        ...cloneConfig(envConfig),
        methodsJson: buildMethodsJson(mergedMethods),
        defaultMethodId: activeConfig.defaultMethodId || mergedMethods.find(method => method.enabled)?.id || envConfig.defaultMethodId
    };
};

const createPaymentConfigService = ({
    PaymentConfigActiveModel = PaymentConfigActive,
    PaymentConfigProposalModel = PaymentConfigProposal,
    PaymentConfigAuditLogModel = PaymentConfigAuditLog,
    envConfig = paymentConfig,
    nodeEnv = process.env.NODE_ENV,
    now = () => new Date(),
    withTransaction = runMongoTransaction
} = {}) => {
    const getLatestActiveConfigDocument = async () => (
        PaymentConfigActiveModel.findOne({}).sort({ version: -1 }).lean()
    );

    const getEffectivePaymentConfig = async () => {
        const active = await getLatestActiveConfigDocument();
        if (!active) {
            return { config: envConfig, source: "env", version: null };
        }

        const mergedConfig = activeMethodOverridesToConfig({ envConfig, activeConfig: active });
        validatePaymentConfig(mergedConfig, { nodeEnv });
        return { config: mergedConfig, source: active.source || "db-proposal", version: active.version };
    };

    const getCurrentConfigSummary = async () => {
        const effective = await getEffectivePaymentConfig();
        const methods = buildPaymentMethods(effective.config);
        return {
            source: effective.source,
            version: effective.version,
            paymentMethods: methods.map(summarizeMethod),
            defaultMethodId: effective.config.defaultMethodId || methods.find(method => method.enabled)?.id || null
        };
    };

    const buildProposalPreview = async ({ methodChanges }) => {
        if (!Array.isArray(methodChanges) || methodChanges.length === 0) {
            throw badRequest("INVALID_PAYMENT_CONFIG_CHANGE", "At least one method change is required");
        }

        const effective = await getEffectivePaymentConfig();
        const currentMethods = buildPaymentMethods(effective.config);
        const currentById = new Map(currentMethods.map(method => [method.id, method]));
        const seen = new Set();
        const sanitizedChanges = methodChanges.map(sanitizeMethodChange);

        sanitizedChanges.forEach((change) => {
            if (seen.has(change.methodId)) {
                throw badRequest("DUPLICATE_PAYMENT_METHOD_CHANGE", "Duplicate payment method change");
            }
            seen.add(change.methodId);

            const allowed = getAllowedPaymentMethod(change.methodId);
            if (!allowed) {
                throw badRequest("INVALID_PAYMENT_METHOD", "Invalid payment method");
            }

            if (!currentById.has(change.methodId)) {
                throw conflict("PAYMENT_METHOD_NOT_ENV_CONFIGURED", "Payment method must be present in server environment config before it can be changed");
            }
        });

        const nextMethods = currentMethods.map((method) => {
            const change = sanitizedChanges.find(item => item.methodId === method.id);
            if (!change) return method;

            const next = { ...method };
            if (Object.prototype.hasOwnProperty.call(change, "enabled")) next.enabled = change.enabled;
            if (Object.prototype.hasOwnProperty.call(change, "confirmations")) next.confirmations = change.confirmations;
            if (Object.prototype.hasOwnProperty.call(change, "treasuryAddress")) {
                const namespace = method.namespace || "eip155";
                if (namespace === "solana") {
                    if (!isValidSolanaPublicKey(change.treasuryAddress)) {
                        throw badRequest("INVALID_PAYMENT_CONFIG_TREASURY", "Invalid Solana treasury address");
                    }
                    next.treasuryAddress = change.treasuryAddress;
                } else {
                    if (!isValidEvmAddress(change.treasuryAddress)) {
                        throw badRequest("INVALID_PAYMENT_CONFIG_TREASURY", "Invalid EVM treasury address");
                    }
                    next.treasuryAddress = normalizeEvmAddress(change.treasuryAddress);
                }
            }
            return next;
        });

        const candidateConfig = {
            ...cloneConfig(effective.config),
            methodsJson: buildMethodsJson(nextMethods),
            defaultMethodId: nextMethods.find(method => method.enabled)?.id || effective.config.defaultMethodId
        };
        validatePaymentConfig(candidateConfig, { nodeEnv });

        const diffs = nextMethods
            .map(method => safeDiffForMethod(currentById.get(method.id), method))
            .filter(Boolean);

        if (diffs.length === 0) {
            throw badRequest("PAYMENT_CONFIG_NOOP", "Proposal does not change payment config");
        }

        return {
            methodChanges: sanitizedChanges,
            normalizedPreview: {
                source: "proposal",
                currentSource: effective.source,
                currentVersion: effective.version,
                defaultMethodId: candidateConfig.defaultMethodId || null,
                methods: nextMethods.map(summarizeMethod),
                diff: diffs
            }
        };
    };

    const appendAudit = async ({ proposalId, actorUserId, action, statusBefore, statusAfter, reason = null, note = null, metadata = undefined }, { session } = {}) => {
        const [audit] = await PaymentConfigAuditLogModel.create([{
            proposalId,
            actorUserId,
            action,
            statusBefore: statusBefore || null,
            statusAfter: statusAfter || null,
            reason,
            note,
            metadata
        }], session ? { session } : undefined);
        return audit;
    };

    const createProposal = async ({ actorUserId, reason, methodChanges }) => {
        const normalizedReason = normalizeReason(reason);
        const preview = await buildProposalPreview({ methodChanges });
        const expiresAt = new Date(now().getTime() + PROPOSAL_TTL_HOURS * 60 * 60 * 1000);
        const [proposal] = await PaymentConfigProposalModel.create([{
            status: "PENDING_CONFIRMATION",
            proposedBy: actorUserId,
            methodChanges: preview.methodChanges,
            normalizedPreview: preview.normalizedPreview,
            reason: normalizedReason,
            confirmationPhrase: CONFIRMATION_PHRASE,
            expiresAt
        }]);

        await appendAudit({
            proposalId: proposal._id,
            actorUserId,
            action: "CREATE_PROPOSAL",
            statusBefore: null,
            statusAfter: proposal.status,
            reason: normalizedReason,
            metadata: { diff: proposal.normalizedPreview.diff }
        });

        return proposal;
    };

    const findProposal = async (proposalId) => {
        const proposal = await PaymentConfigProposalModel.findById(proposalId);
        if (!proposal) {
            throw notFound("PAYMENT_CONFIG_PROPOSAL_NOT_FOUND", "Payment config proposal was not found");
        }
        if (proposal.status !== "EXPIRED" && proposal.expiresAt && proposal.expiresAt.getTime() <= now().getTime()) {
            proposal.status = "EXPIRED";
            await proposal.save();
        }
        return proposal;
    };

    const listProposals = async ({ status, limit = 25 } = {}) => {
        const parsedLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
        const filter = status ? { status } : {};
        const proposals = await PaymentConfigProposalModel.find(filter).sort({ createdAt: -1, _id: -1 }).limit(parsedLimit).lean();
        return { proposals, limit: parsedLimit };
    };

    const listAudits = async (proposalId) => (
        PaymentConfigAuditLogModel.find({ proposalId }).sort({ createdAt: -1, _id: -1 }).lean()
    );

    const confirmProposal = async ({ proposalId, actorUserId, confirmationPhrase }) => {
        const proposal = await findProposal(proposalId);
        if (proposal.status !== "PENDING_CONFIRMATION") {
            throw conflict("PAYMENT_CONFIG_PROPOSAL_NOT_CONFIRMABLE", "Payment config proposal cannot be confirmed");
        }
        if (confirmationPhrase !== CONFIRMATION_PHRASE) {
            throw badRequest("INVALID_PAYMENT_CONFIG_CONFIRMATION", "Invalid payment config confirmation phrase");
        }

        const statusBefore = proposal.status;
        proposal.confirmedBy = actorUserId;
        proposal.confirmedAt = now();
        proposal.status = nodeEnv === "production" ? "PENDING_APPROVAL" : "APPROVED";
        await proposal.save();
        await appendAudit({
            proposalId: proposal._id,
            actorUserId,
            action: "CONFIRM_PROPOSAL",
            statusBefore,
            statusAfter: proposal.status,
            metadata: { diff: proposal.normalizedPreview.diff }
        });
        return proposal;
    };

    const approveProposal = async ({ proposalId, actorUserId }) => {
        const proposal = await findProposal(proposalId);
        if (proposal.status !== "PENDING_APPROVAL") {
            throw conflict("PAYMENT_CONFIG_PROPOSAL_NOT_APPROVABLE", "Payment config proposal cannot be approved");
        }
        if (nodeEnv === "production" && String(proposal.proposedBy) === String(actorUserId)) {
            throw conflict("PAYMENT_CONFIG_DUAL_APPROVAL_REQUIRED", "A second distinct admin must approve production payment config changes");
        }

        const statusBefore = proposal.status;
        proposal.approvedBy = actorUserId;
        proposal.approvedAt = now();
        proposal.status = "APPROVED";
        await proposal.save();
        await appendAudit({
            proposalId: proposal._id,
            actorUserId,
            action: "APPROVE_PROPOSAL",
            statusBefore,
            statusAfter: proposal.status,
            metadata: { diff: proposal.normalizedPreview.diff }
        });
        return proposal;
    };

    const activateProposal = async ({ proposalId, actorUserId }) => {
        const proposal = await findProposal(proposalId);
        if (proposal.status !== "APPROVED") {
            throw conflict("PAYMENT_CONFIG_PROPOSAL_NOT_ACTIVATABLE", "Payment config proposal cannot be activated");
        }

        return withTransaction(async (session) => {
            const currentQuery = PaymentConfigActiveModel.findOne({}).sort({ version: -1 });
            const current = await withSession(currentQuery, session).lean();
            const nextVersion = (current?.version || 0) + 1;
            const activeMethods = proposal.normalizedPreview.methods.map(method => ({
                id: method.id,
                enabled: method.enabled,
                treasuryAddress: method.treasuryAddress,
                confirmations: method.confirmations
            }));
            const [active] = await PaymentConfigActiveModel.create([{
                version: nextVersion,
                source: "db-proposal",
                methods: activeMethods,
                defaultMethodId: proposal.normalizedPreview.defaultMethodId || null,
                activatedProposalId: proposal._id,
                activatedBy: actorUserId
            }], { session });

            const statusBefore = proposal.status;
            proposal.activatedBy = actorUserId;
            proposal.activatedAt = now();
            proposal.status = "ACTIVATED";
            await proposal.save({ session });
            await appendAudit({
                proposalId: proposal._id,
                actorUserId,
                action: "ACTIVATE_PROPOSAL",
                statusBefore,
                statusAfter: proposal.status,
                metadata: { version: active.version, diff: proposal.normalizedPreview.diff }
            }, { session });

            return { proposal, active };
        });
    };

    const rejectProposal = async ({ proposalId, actorUserId, note }) => {
        const proposal = await findProposal(proposalId);
        if (!["PENDING_CONFIRMATION", "PENDING_APPROVAL", "APPROVED"].includes(proposal.status)) {
            throw conflict("PAYMENT_CONFIG_PROPOSAL_NOT_REJECTABLE", "Payment config proposal cannot be rejected");
        }
        const statusBefore = proposal.status;
        proposal.rejectedBy = actorUserId;
        proposal.rejectedAt = now();
        proposal.status = "REJECTED";
        await proposal.save();
        await appendAudit({
            proposalId: proposal._id,
            actorUserId,
            action: "REJECT_PROPOSAL",
            statusBefore,
            statusAfter: proposal.status,
            note: normalizeNote(note)
        });
        return proposal;
    };

    const cancelProposal = async ({ proposalId, actorUserId, note }) => {
        const proposal = await findProposal(proposalId);
        if (!["PENDING_CONFIRMATION", "PENDING_APPROVAL", "APPROVED"].includes(proposal.status)) {
            throw conflict("PAYMENT_CONFIG_PROPOSAL_NOT_CANCELLABLE", "Payment config proposal cannot be cancelled");
        }
        const statusBefore = proposal.status;
        proposal.cancelledBy = actorUserId;
        proposal.cancelledAt = now();
        proposal.status = "CANCELLED";
        await proposal.save();
        await appendAudit({
            proposalId: proposal._id,
            actorUserId,
            action: "CANCEL_PROPOSAL",
            statusBefore,
            statusAfter: proposal.status,
            note: normalizeNote(note)
        });
        return proposal;
    };

    return {
        activateProposal,
        approveProposal,
        cancelProposal,
        confirmProposal,
        createProposal,
        findProposal,
        getCurrentConfigSummary,
        getEffectivePaymentConfig,
        listAudits,
        listProposals,
        rejectProposal,
        buildProposalPreview
    };
};

module.exports = createPaymentConfigService();
module.exports.createPaymentConfigService = createPaymentConfigService;
module.exports.CONFIRMATION_PHRASE = CONFIRMATION_PHRASE;
