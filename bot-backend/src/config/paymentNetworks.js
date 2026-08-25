const { normalizeEvmAddress } = require("../utils/evmAddress");

const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BNB_MAINNET_CHAIN_ID = 56;

const baseMainnetUsdcAddress = normalizeEvmAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const baseSepoliaUsdcAddress = normalizeEvmAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const bnbMainnetUsdtAddress = normalizeEvmAddress("0x55d398326f99059ff775485246999027b3197955");
const bnbMainnetUsdcAddress = normalizeEvmAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d");

const allowedPaymentMethods = Object.freeze({
    "base-mainnet-usdc": Object.freeze({
        id: "base-mainnet-usdc",
        network: "base-mainnet",
        name: "Base mainnet USDC",
        chainId: BASE_MAINNET_CHAIN_ID,
        tokenAddress: baseMainnetUsdcAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        production: true
    }),
    "base-sepolia-usdc": Object.freeze({
        id: "base-sepolia-usdc",
        network: "base-sepolia",
        name: "Base Sepolia USDC",
        chainId: BASE_SEPOLIA_CHAIN_ID,
        tokenAddress: baseSepoliaUsdcAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        production: false
    }),
    "bnb-mainnet-usdt": Object.freeze({
        id: "bnb-mainnet-usdt",
        network: "bnb-mainnet",
        name: "BNB Chain USDT",
        chainId: BNB_MAINNET_CHAIN_ID,
        tokenAddress: bnbMainnetUsdtAddress,
        tokenSymbol: "USDT",
        tokenDecimals: 18,
        production: true
    }),
    "bnb-mainnet-usdc": Object.freeze({
        id: "bnb-mainnet-usdc",
        network: "bnb-mainnet",
        name: "BNB Chain USDC",
        chainId: BNB_MAINNET_CHAIN_ID,
        tokenAddress: bnbMainnetUsdcAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 18,
        production: true
    })
});

const legacyNetworkToMethodId = Object.freeze({
    "base-mainnet": "base-mainnet-usdc",
    "base-sepolia": "base-sepolia-usdc"
});

const getAllowedPaymentMethod = (methodId) => allowedPaymentMethods[methodId] || null;
const getAllowedPaymentMethodByLegacyNetwork = (network) => getAllowedPaymentMethod(legacyNetworkToMethodId[network]);

module.exports = {
    BASE_MAINNET_CHAIN_ID,
    BASE_SEPOLIA_CHAIN_ID,
    BNB_MAINNET_CHAIN_ID,
    baseMainnetUsdcAddress,
    baseSepoliaUsdcAddress,
    bnbMainnetUsdtAddress,
    bnbMainnetUsdcAddress,
    allowedPaymentMethods,
    legacyNetworkToMethodId,
    getAllowedPaymentMethod,
    getAllowedPaymentMethodByLegacyNetwork,
    // Compatibility aliases for older tests/imports.
    supportedPaymentNetworks: allowedPaymentMethods,
    getSupportedPaymentNetwork: (chainId) => Object.values(allowedPaymentMethods).find(method => method.chainId === chainId) || null,
    getSupportedPaymentNetworkByName: getAllowedPaymentMethodByLegacyNetwork,
    getExpectedPaymentTokenAddress: (chainId) => Object.values(allowedPaymentMethods).find(method => method.chainId === chainId)?.tokenAddress || null
};
