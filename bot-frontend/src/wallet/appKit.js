import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { solana, solanaDevnet } from "@reown/appkit/networks";
import { SolanaAdapter } from "@reown/appkit-adapter-solana/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet, base, baseSepolia, bsc } from "viem/chains";
import { WagmiProvider } from "wagmi";
import config from "../config/config";

const networks = [mainnet, base, baseSepolia, bsc, solana, solanaDevnet];
const networkByName = {
    "ethereum-mainnet": mainnet,
    "base-mainnet": base,
    "base-sepolia": baseSepolia,
    "bnb-mainnet": bsc,
    "solana-mainnet": solana,
    "solana-devnet": solanaDevnet
};
const expectedNetwork = networkByName[config.paymentNetworkName] || base;
const queryClient = new QueryClient();
const appKitStateKey = "__youtubeBotAppKit";

let wagmiAdapter = null;
let solanaAdapter = null;
let initializationError = null;

if (typeof window !== "undefined" && window[appKitStateKey]) {
    wagmiAdapter = window[appKitStateKey].wagmiAdapter;
    solanaAdapter = window[appKitStateKey].solanaAdapter;
    initializationError = window[appKitStateKey].initializationError;
} else if (config.walletConnectProjectId) {
    try {
        solanaAdapter = new SolanaAdapter();
        wagmiAdapter = new WagmiAdapter({
            networks,
            projectId: config.walletConnectProjectId
        });

        createAppKit({
            adapters: [wagmiAdapter, solanaAdapter],
            networks,
            projectId: config.walletConnectProjectId,
            defaultNetwork: expectedNetwork,
            metadata: {
                name: "YouTube Bot",
                description: "YouTube Bot credit payments",
                url: window.location.origin,
                icons: [`${window.location.origin}/logo192.png`]
            },
            features: {
                analytics: false,
                email: false,
                socials: []
            }
        });
    } catch (error) {
        initializationError = error;
        wagmiAdapter = null;
    }

    if (typeof window !== "undefined") {
        window[appKitStateKey] = {
            wagmiAdapter,
            solanaAdapter,
            initializationError
        };
    }
}

export const isWalletConnectConfigured = Boolean(wagmiAdapter);
export const walletConnectInitializationError = initializationError;
export const appKitNetworks = networks;
export const appKitExpectedNetwork = expectedNetwork;

const WalletConnectionProvider = ({ children }) => {
    if (!wagmiAdapter) return children;

    return (
        <WagmiProvider config={wagmiAdapter.wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                {children}
            </QueryClientProvider>
        </WagmiProvider>
    );
};

export default WalletConnectionProvider;
