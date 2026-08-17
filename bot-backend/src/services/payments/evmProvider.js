const { Interface, JsonRpcProvider } = require("ethers");
const { paymentConfig } = require("../../config/config");
const { normalizeEvmAddress } = require("../../utils/evmAddress");

const erc20Interface = new Interface([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

const createEvmProvider = ({
    rpcUrl = paymentConfig.rpcUrl,
    ProviderClass = JsonRpcProvider,
    provider
} = {}) => {
    const rpcProvider = provider || new ProviderClass(rpcUrl);

    const parseTransferLogs = (receipt, tokenAddress) => {
        const normalizedTokenAddress = normalizeEvmAddress(tokenAddress);
        if (!receipt?.logs || !normalizedTokenAddress) return [];

        return receipt.logs
            .filter(log => normalizeEvmAddress(log.address) === normalizedTokenAddress)
            .map((log) => {
                try {
                    const parsed = erc20Interface.parseLog(log);
                    if (parsed?.name !== "Transfer") return null;

                    return {
                        from: normalizeEvmAddress(parsed.args.from),
                        to: normalizeEvmAddress(parsed.args.to),
                        value: parsed.args.value
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    };

    return {
        getNetworkChainId: async () => {
            const network = await rpcProvider.getNetwork();
            return Number(network.chainId);
        },
        getTransaction: (txHash) => rpcProvider.getTransaction(txHash),
        getTransactionReceipt: (txHash) => rpcProvider.getTransactionReceipt(txHash),
        getBlockNumber: () => rpcProvider.getBlockNumber(),
        parseTransferLogs
    };
};

module.exports = { createEvmProvider };
