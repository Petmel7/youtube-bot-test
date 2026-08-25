const paymentNetworks = {
    "base-mainnet": {
        id: 8453,
        name: "Base mainnet"
    },
    "base-sepolia": {
        id: 84532,
        name: "Base Sepolia"
    },
    "bnb-mainnet": {
        id: 56,
        name: "BNB Chain"
    }
};

const configuredPaymentNetwork = process.env.REACT_APP_PAYMENT_NETWORK || "base-mainnet";

const config = {
    backendUrl: process.env.REACT_APP_BACKEND_URL || "http://localhost:10000",
    walletConnectProjectId: process.env.REACT_APP_WALLETCONNECT_PROJECT_ID || "",
    paymentNetworkName: paymentNetworks[configuredPaymentNetwork] ? configuredPaymentNetwork : "base-mainnet",
    paymentNetwork: paymentNetworks[configuredPaymentNetwork] || paymentNetworks["base-mainnet"],
    paymentNetworks
};

export default config;
