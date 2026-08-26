const { normalizeEvmAddress } = require("../utils/evmAddress");
const {
    allowedPaymentMethods,
    getAllowedPaymentMethod,
    getAllowedPaymentMethodByLegacyNetwork
} = require("./paymentNetworks");

const isTruthy = (value) => value === true || value === "true";

const freezeMethodSnapshot = (method) => Object.freeze({
    id: method.id,
    name: method.name,
    namespace: method.namespace || "eip155",
    network: method.network,
    networkId: method.networkId || (method.chainId ? String(method.chainId) : undefined),
    cluster: method.cluster,
    chainId: method.chainId,
    rpcUrl: method.rpcUrl,
    assetType: method.assetType || "erc20",
    assetProvenance: method.assetProvenance,
    tokenAddress: method.tokenAddress ? normalizeEvmAddress(method.tokenAddress) : undefined,
    mintAddress: method.mintAddress,
    tokenSymbol: method.tokenSymbol,
    tokenDecimals: method.tokenDecimals,
    treasuryAddress: method.namespace === "solana" ? method.treasuryAddress : normalizeEvmAddress(method.treasuryAddress),
    confirmations: method.confirmations,
    enabled: Boolean(method.enabled),
    production: Boolean(method.production)
});

const parsePaymentMethodsJson = (methodsJson) => {
    if (!methodsJson) return null;

    let parsed;
    try {
        parsed = JSON.parse(methodsJson);
    } catch {
        throw new Error("Invalid PAYMENT_METHODS_JSON configuration");
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Invalid PAYMENT_METHODS_JSON configuration");
    }

    return parsed;
};

const buildLegacyPaymentMethodConfig = (config) => {
    const allowed = getAllowedPaymentMethodByLegacyNetwork(config.network);
    if (!allowed) return [];

    return [{
        id: allowed.id,
        enabled: true,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        tokenAddress: config.tokenAddress,
        tokenSymbol: config.tokenSymbol,
        tokenDecimals: config.tokenDecimals,
        treasuryAddress: config.treasuryAddress,
        confirmations: config.confirmations
    }];
};

const buildPaymentMethods = (config) => {
    const configuredMethods = parsePaymentMethodsJson(config.methodsJson) || buildLegacyPaymentMethodConfig(config);
    const seen = new Set();

    return configuredMethods.map((configured) => {
        if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
            throw new Error("Invalid PAYMENT_METHODS_JSON configuration");
        }

        const allowed = getAllowedPaymentMethod(configured.id);
        if (!allowed) {
            throw new Error("Invalid PAYMENT_METHOD_ID configuration");
        }

        if (seen.has(configured.id)) {
            throw new Error(`Duplicate payment method id: ${configured.id}`);
        }
        seen.add(configured.id);

        return freezeMethodSnapshot({
            ...allowed,
            enabled: isTruthy(configured.enabled),
            chainId: Number(configured.chainId ?? allowed.chainId),
            networkId: configured.networkId ?? allowed.networkId,
            cluster: configured.cluster ?? allowed.cluster,
            rpcUrl: configured.rpcUrl,
            tokenAddress: configured.tokenAddress ?? allowed.tokenAddress,
            mintAddress: configured.mintAddress ?? allowed.mintAddress,
            tokenSymbol: configured.tokenSymbol ?? allowed.tokenSymbol,
            tokenDecimals: Number(configured.tokenDecimals ?? allowed.tokenDecimals),
            treasuryAddress: configured.treasuryAddress,
            confirmations: Number(configured.confirmations ?? config.confirmations)
        });
    });
};

const getEnabledPaymentMethods = (config) => Object.freeze(buildPaymentMethods(config));
const getPaymentMethodById = (config, paymentMethodId) => (
    getEnabledPaymentMethods(config).find(method => method.enabled && method.id === paymentMethodId) || null
);

module.exports = {
    allowedPaymentMethods,
    buildLegacyPaymentMethodConfig,
    buildPaymentMethods,
    getEnabledPaymentMethods,
    getPaymentMethodById,
    parsePaymentMethodsJson
};
