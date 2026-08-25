import {
    Connection,
    PublicKey,
    Transaction
} from "@solana/web3.js";
import {
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getAccount,
    getAssociatedTokenAddress
} from "@solana/spl-token";

const endpointByCluster = {
    "mainnet-beta": "https://api.mainnet-beta.solana.com",
    mainnet: "https://api.mainnet-beta.solana.com",
    devnet: "https://api.devnet.solana.com",
    testnet: "https://api.testnet.solana.com"
};

const getSolanaEndpoint = (intent) => endpointByCluster[intent?.paymentMethod?.cluster] || endpointByCluster.devnet;

const assertSolanaIntent = (intent) => {
    if (intent?.namespace !== "solana" && intent?.paymentMethod?.namespace !== "solana") {
        throw new Error("Invalid Solana payment intent");
    }
    if (!intent?.token?.mintAddress && !intent?.token?.address) {
        throw new Error("Missing SPL token mint");
    }
    if (!intent?.recipientAddress) {
        throw new Error("Missing Solana treasury address");
    }
    if (!/^(0|[1-9][0-9]*)$/.test(String(intent?.expectedTokenAmountBaseUnits || ""))) {
        throw new Error("Missing SPL token amount");
    }
};

const getProviderAddress = (provider) => (
    provider?.publicKey?.toString?.() ||
    provider?.account?.address ||
    provider?.address ||
    ""
);

const sendTransactionWithProvider = async ({ provider, transaction, connection }) => {
    if (provider?.sendTransaction) {
        return provider.sendTransaction(transaction, connection);
    }

    if (provider?.signAndSendTransaction) {
        const result = await provider.signAndSendTransaction(transaction);
        return result?.signature || result;
    }

    throw new Error("Solana wallet cannot send transactions");
};

export const sendSolanaSplTokenPayment = async ({ intent, provider, payerAddress: connectedPayerAddress = "" }) => {
    assertSolanaIntent(intent);

    const payerAddress = connectedPayerAddress || getProviderAddress(provider);
    if (!payerAddress || payerAddress !== intent.payerAddress) {
        throw new Error("Connected Solana wallet does not match this payment");
    }

    const connection = new Connection(getSolanaEndpoint(intent), "confirmed");
    const payer = new PublicKey(payerAddress);
    const mint = new PublicKey(intent.token.mintAddress || intent.token.address);
    const treasury = new PublicKey(intent.recipientAddress);
    const sourceTokenAccount = await getAssociatedTokenAddress(mint, payer);
    const destinationTokenAccount = await getAssociatedTokenAddress(mint, treasury);
    const transaction = new Transaction();

    try {
        await getAccount(connection, sourceTokenAccount, "confirmed");
    } catch {
        throw new Error("Your wallet does not have an associated token account for this SPL token");
    }

    try {
        await getAccount(connection, destinationTokenAccount, "confirmed");
    } catch {
        transaction.add(createAssociatedTokenAccountInstruction(
            payer,
            destinationTokenAccount,
            treasury,
            mint
        ));
    }

    transaction.add(createTransferCheckedInstruction(
        sourceTokenAccount,
        mint,
        destinationTokenAccount,
        payer,
        window.BigInt(intent.expectedTokenAmountBaseUnits),
        Number(intent.token.decimals)
    ));

    transaction.feePayer = payer;
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;

    return sendTransactionWithProvider({ provider, transaction, connection });
};

export const getInjectedSolanaProvider = () => {
    if (typeof window === "undefined") return null;
    return window.solana || null;
};
