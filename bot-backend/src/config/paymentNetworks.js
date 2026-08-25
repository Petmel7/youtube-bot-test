const { normalizeEvmAddress } = require("../utils/evmAddress");

const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BNB_MAINNET_CHAIN_ID = 56;
const SOLANA_MAINNET_NETWORK_ID = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_DEVNET_NETWORK_ID = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const baseMainnetUsdcAddress = normalizeEvmAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const baseSepoliaUsdcAddress = normalizeEvmAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const bnbMainnetUsdtAddress = normalizeEvmAddress("0x55d398326f99059ff775485246999027b3197955");
const bnbMainnetUsdcAddress = normalizeEvmAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d");
const solanaMainnetUsdcMintAddress = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const solanaMainnetUsdtMintAddress = "Es9vMFrzaCERmJfrF4H2FYD4uqwEcj4x2tYfJ9Q3K4x";
const solanaDevnetUsdcMintAddress = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

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
    }),
    "solana-mainnet-usdc": Object.freeze({
        id: "solana-mainnet-usdc",
        namespace: "solana",
        network: "solana-mainnet",
        networkId: SOLANA_MAINNET_NETWORK_ID,
        cluster: "mainnet-beta",
        name: "Solana mainnet USDC",
        assetType: "spl-token",
        mintAddress: solanaMainnetUsdcMintAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        production: true
    }),
    "solana-mainnet-usdt": Object.freeze({
        id: "solana-mainnet-usdt",
        namespace: "solana",
        network: "solana-mainnet",
        networkId: SOLANA_MAINNET_NETWORK_ID,
        cluster: "mainnet-beta",
        name: "Solana mainnet USDT",
        assetType: "spl-token",
        mintAddress: solanaMainnetUsdtMintAddress,
        tokenSymbol: "USDT",
        tokenDecimals: 6,
        production: true
    }),
    "solana-devnet-usdc": Object.freeze({
        id: "solana-devnet-usdc",
        namespace: "solana",
        network: "solana-devnet",
        networkId: SOLANA_DEVNET_NETWORK_ID,
        cluster: "devnet",
        name: "Solana devnet USDC",
        assetType: "spl-token",
        mintAddress: solanaDevnetUsdcMintAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        production: false
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
    SOLANA_MAINNET_NETWORK_ID,
    SOLANA_DEVNET_NETWORK_ID,
    baseMainnetUsdcAddress,
    baseSepoliaUsdcAddress,
    bnbMainnetUsdtAddress,
    bnbMainnetUsdcAddress,
    solanaMainnetUsdcMintAddress,
    solanaMainnetUsdtMintAddress,
    solanaDevnetUsdcMintAddress,
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
