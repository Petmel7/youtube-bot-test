const { normalizeEvmAddress } = require("../utils/evmAddress");

const ETHEREUM_MAINNET_CHAIN_ID = 1;
const ETHEREUM_SEPOLIA_CHAIN_ID = 11155111;
const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BNB_MAINNET_CHAIN_ID = 56;
const BNB_TESTNET_CHAIN_ID = 97;
const SOLANA_MAINNET_NETWORK_ID = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_DEVNET_NETWORK_ID = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

const ethereumMainnetUsdcAddress = normalizeEvmAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const ethereumMainnetUsdtAddress = normalizeEvmAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7");
const ethereumSepoliaUsdtAddress = normalizeEvmAddress("0x7169d38820dfd117c3fa1f22a697dba58d90ba06");
const baseMainnetUsdcAddress = normalizeEvmAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const baseSepoliaUsdcAddress = normalizeEvmAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
const bnbMainnetUsdcAddress = normalizeEvmAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d");
const bnbMainnetUsdtAddress = normalizeEvmAddress("0x55d398326f99059ff775485246999027b3197955");
const bnbTestnetUsdcAddress = normalizeEvmAddress("0x64544969ed7EBf5f083679233325356EbE738930");
const bnbTestnetUsdtAddress = normalizeEvmAddress("0x668a9fDc6C6790985eF03EbEFeB72D8a0eF652d5");
const solanaMainnetUsdcMintAddress = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const solanaMainnetUsdtMintAddress = "Es9vMFrzaCERmJfrF4H2FYD4uqwEcj4x2tYfJ9Q3K4x";
const solanaDevnetUsdcMintAddress = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

const allowedPaymentMethods = Object.freeze({
    "ethereum-mainnet-usdc": Object.freeze({
        id: "ethereum-mainnet-usdc",
        network: "ethereum-mainnet",
        name: "Ethereum · USDC",
        chainId: ETHEREUM_MAINNET_CHAIN_ID,
        tokenAddress: ethereumMainnetUsdcAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        assetProvenance: "circle-native",
        production: true
    }),
    "ethereum-mainnet-usdt": Object.freeze({
        id: "ethereum-mainnet-usdt",
        network: "ethereum-mainnet",
        name: "Ethereum · USDT",
        chainId: ETHEREUM_MAINNET_CHAIN_ID,
        tokenAddress: ethereumMainnetUsdtAddress,
        tokenSymbol: "USDT",
        tokenDecimals: 6,
        assetProvenance: "tether-native",
        production: true
    }),
    "ethereum-sepolia-usdt": Object.freeze({
        id: "ethereum-sepolia-usdt",
        network: "ethereum-sepolia",
        name: "Ethereum Sepolia · USDT",
        chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
        tokenAddress: ethereumSepoliaUsdtAddress,
        tokenSymbol: "USDT",
        tokenDecimals: 6,
        assetProvenance: "ethereum-sepolia-smoke",
        production: false
    }),
    "base-mainnet-usdc": Object.freeze({
        id: "base-mainnet-usdc",
        network: "base-mainnet",
        name: "Base mainnet USDC",
        chainId: BASE_MAINNET_CHAIN_ID,
        tokenAddress: baseMainnetUsdcAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        assetProvenance: "circle-native",
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
        assetProvenance: "circle-native",
        production: false
    }),
    "bnb-mainnet-usdc": Object.freeze({
        id: "bnb-mainnet-usdc",
        network: "bnb-mainnet",
        name: "BNB Chain · Binance-Peg USDC",
        chainId: BNB_MAINNET_CHAIN_ID,
        tokenAddress: bnbMainnetUsdcAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 18,
        assetProvenance: "binance-peg",
        production: true
    }),
    "bnb-mainnet-usdt": Object.freeze({
        id: "bnb-mainnet-usdt",
        network: "bnb-mainnet",
        name: "BNB Chain · Binance-Peg USDT",
        chainId: BNB_MAINNET_CHAIN_ID,
        tokenAddress: bnbMainnetUsdtAddress,
        tokenSymbol: "USDT",
        tokenDecimals: 18,
        assetProvenance: "binance-peg",
        production: true
    }),
    "bnb-testnet-usdc": Object.freeze({
        id: "bnb-testnet-usdc",
        network: "bnb-testnet",
        name: "BNB Chain testnet USDC",
        chainId: BNB_TESTNET_CHAIN_ID,
        tokenAddress: bnbTestnetUsdcAddress,
        tokenSymbol: "USDC",
        tokenDecimals: 18,
        assetProvenance: "bnb-testnet",
        production: false
    }),
    "bnb-testnet-usdt": Object.freeze({
        id: "bnb-testnet-usdt",
        network: "bnb-testnet",
        name: "BNB Chain testnet · USDT",
        chainId: BNB_TESTNET_CHAIN_ID,
        tokenAddress: bnbTestnetUsdtAddress,
        tokenSymbol: "USDT",
        tokenDecimals: 18,
        assetProvenance: "bnb-testnet",
        production: false
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
    ETHEREUM_MAINNET_CHAIN_ID,
    ETHEREUM_SEPOLIA_CHAIN_ID,
    BASE_MAINNET_CHAIN_ID,
    BASE_SEPOLIA_CHAIN_ID,
    BNB_MAINNET_CHAIN_ID,
    BNB_TESTNET_CHAIN_ID,
    SOLANA_MAINNET_NETWORK_ID,
    SOLANA_DEVNET_NETWORK_ID,
    ethereumMainnetUsdcAddress,
    ethereumMainnetUsdtAddress,
    ethereumSepoliaUsdtAddress,
    baseMainnetUsdcAddress,
    baseSepoliaUsdcAddress,
    bnbMainnetUsdcAddress,
    bnbMainnetUsdtAddress,
    bnbTestnetUsdcAddress,
    bnbTestnetUsdtAddress,
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
