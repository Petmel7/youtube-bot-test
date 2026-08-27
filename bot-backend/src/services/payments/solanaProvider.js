const jsonRpc = async ({ rpcUrl, method, params = [] }) => {
    const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method,
            params
        })
    });

    if (!response.ok) {
        throw new Error(`Solana RPC failed with ${response.status}`);
    }

    const body = await response.json();
    if (body.error) {
        throw new Error(body.error.message || "Solana RPC error");
    }

    return body.result;
};

const accountKeyAt = (transaction, accountIndex) => {
    const key = transaction?.transaction?.message?.accountKeys?.[accountIndex];
    if (!key) return null;
    if (typeof key === "string") return key;
    return key.pubkey || key.toString?.() || null;
};

const tokenBalanceKey = (transaction, balance) => (
    balance?.pubkey || balance?.account || accountKeyAt(transaction, balance?.accountIndex)
);

const tokenAccountMap = (transaction, mintAddress) => {
    const map = new Map();
    for (const balance of [...(transaction?.meta?.preTokenBalances || []), ...(transaction?.meta?.postTokenBalances || [])]) {
        if (balance?.mint !== mintAddress) continue;
        const key = tokenBalanceKey(transaction, balance);
        if (!key) continue;
        map.set(key, {
            account: key,
            mint: balance.mint,
            owner: balance.owner || null
        });
    }
    return map;
};

const flattenInstructions = (transaction) => {
    const instructions = [];
    for (const instruction of transaction?.transaction?.message?.instructions || []) {
        instructions.push(instruction);
    }
    for (const group of transaction?.meta?.innerInstructions || []) {
        for (const instruction of group.instructions || []) {
            instructions.push(instruction);
        }
    }
    return instructions;
};

const parsedTransferFromInstruction = (instruction) => {
    const parsed = instruction?.parsed;
    const type = parsed?.type;
    const info = parsed?.info || {};
    if (instruction?.program !== "spl-token" && instruction?.programId !== "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA") {
        return null;
    }
    if (type !== "transfer" && type !== "transferChecked") {
        return null;
    }

    const amount = type === "transferChecked"
        ? info.tokenAmount?.amount
        : info.amount;
    if (typeof amount !== "string" || !/^(0|[1-9][0-9]*)$/.test(amount)) {
        return null;
    }

    return {
        source: info.source,
        destination: info.destination,
        authority: info.authority || info.multisigAuthority || null,
        mint: info.mint || info.tokenAmount?.mint || null,
        value: BigInt(amount)
    };
};

const findTokenTransfer = (transaction, { mintAddress, sourceOwner, destinationOwner }) => {
    const transfers = [];
    const tokenAccounts = tokenAccountMap(transaction, mintAddress);

    for (const instruction of flattenInstructions(transaction)) {
        const transfer = parsedTransferFromInstruction(instruction);
        if (!transfer) continue;
        if (transfer.mint && transfer.mint !== mintAddress) continue;

        const source = tokenAccounts.get(transfer.source);
        const destination = tokenAccounts.get(transfer.destination);
        if (!source || !destination) continue;
        if (source.mint !== mintAddress || destination.mint !== mintAddress) continue;
        if (source.owner !== sourceOwner || destination.owner !== destinationOwner) continue;
        if (transfer.authority && transfer.authority !== sourceOwner) continue;
        if (transfer.value <= 0n) continue;

        transfers.push({
            from: source.owner,
            to: destination.owner,
            sourceTokenAccount: transfer.source,
            destinationTokenAccount: transfer.destination,
            value: transfer.value
        });
    }

    if (transfers.length !== 1) return transfers.length > 1 ? { ambiguous: true } : null;
    return transfers[0];
};

const createSolanaProvider = ({ rpcUrl }) => ({
    async getGenesisHash() {
        return jsonRpc({ rpcUrl, method: "getGenesisHash" });
    },
    async getSignatureStatus(signature) {
        const result = await jsonRpc({
            rpcUrl,
            method: "getSignatureStatuses",
            params: [[signature], { searchTransactionHistory: true }]
        });
        return result?.value?.[0] || null;
    },
    async getParsedTransaction(signature) {
        return jsonRpc({
            rpcUrl,
            method: "getTransaction",
            params: [signature, {
                encoding: "jsonParsed",
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0
            }]
        });
    },
    findTokenTransfer
});

module.exports = {
    createSolanaProvider,
    findTokenTransfer
};
