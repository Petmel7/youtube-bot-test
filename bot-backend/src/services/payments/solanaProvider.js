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

const tokenAmount = (balance) => {
    const amount = balance?.uiTokenAmount?.amount;
    return typeof amount === "string" && /^(0|[1-9][0-9]*)$/.test(amount) ? BigInt(amount) : 0n;
};

const findTokenTransfer = (transaction, { mintAddress, sourceOwner, destinationOwner }) => {
    const meta = transaction?.meta;
    if (!meta) return null;

    const preByIndex = new Map((meta.preTokenBalances || []).map(balance => [balance.accountIndex, balance]));
    const transfers = [];

    for (const post of meta.postTokenBalances || []) {
        if (post.mint !== mintAddress || post.owner !== destinationOwner) continue;

        const pre = preByIndex.get(post.accountIndex);
        const received = tokenAmount(post) - tokenAmount(pre);
        if (received <= 0n) continue;

        const source = (meta.preTokenBalances || []).find((candidate) => (
            candidate.mint === mintAddress &&
            candidate.owner === sourceOwner &&
            tokenAmount(candidate) - tokenAmount((meta.postTokenBalances || []).find(item => item.accountIndex === candidate.accountIndex)) === received
        ));

        if (source) {
            transfers.push({
                from: source.owner,
                to: post.owner,
                value: received
            });
        }
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
