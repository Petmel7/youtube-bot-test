const { normalizeEvmAddress } = require("../utils/evmAddress");

const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_SEPOLIA_CHAIN_ID = 84532;

const baseMainnetUsdcAddress = normalizeEvmAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const baseSepoliaUsdcAddress = normalizeEvmAddress("0x036CbD53842c5426634e7929541eC2318f3dCF7e");

const supportedPaymentNetworks = Object.freeze({
    baseMainnet: Object.freeze({
        key: "baseMainnet",
        name: "Base mainnet",
        chainId: BASE_MAINNET_CHAIN_ID,
        tokenAddress: baseMainnetUsdcAddress,
        production: true
    }),
    baseSepolia: Object.freeze({
        key: "baseSepolia",
        name: "Base Sepolia",
        chainId: BASE_SEPOLIA_CHAIN_ID,
        tokenAddress: baseSepoliaUsdcAddress,
        production: false
    })
});

const supportedPaymentNetworksByChainId = new Map(
    Object.values(supportedPaymentNetworks).map(network => [network.chainId, network])
);

const getSupportedPaymentNetwork = (chainId) => supportedPaymentNetworksByChainId.get(chainId) || null;

const getExpectedPaymentTokenAddress = (chainId) => getSupportedPaymentNetwork(chainId)?.tokenAddress || null;

module.exports = {
    BASE_MAINNET_CHAIN_ID,
    BASE_SEPOLIA_CHAIN_ID,
    baseMainnetUsdcAddress,
    baseSepoliaUsdcAddress,
    supportedPaymentNetworks,
    getSupportedPaymentNetwork,
    getExpectedPaymentTokenAddress
};
