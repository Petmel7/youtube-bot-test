const toSafeUser = (user) => {
    if (!user) return null;

    return {
        id: String(user._id || user.id),
        name: user.name,
        email: user.email,
        picture: user.picture || null,
        role: user.role || "user",
        youtubeConnected: Boolean(user.tokens?.refresh_token || user.tokens?.access_token)
    };
};

const toPromptDto = (prompt) => {
    if (!prompt) return null;

    return {
        id: String(prompt._id || prompt.id),
        channelTheme: prompt.channelTheme,
        gender: prompt.gender || (prompt.genderText === "You are a woman." ? "female" : "male"),
        generalPrompt: prompt.generalPrompt,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt
    };
};

const toBotRunDto = (run) => {
    if (!run) return null;

    return {
        id: String(run._id || run.id),
        videoId: run.videoId,
        status: run.status,
        processedCount: run.processedCount,
        successCount: run.successCount,
        failureCount: run.failureCount,
        skippedCount: run.skippedCount,
        errorCode: run.errorCode || null,
        errorMessage: run.errorMessage || null,
        startedAt: run.startedAt || null,
        completedAt: run.completedAt || null,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt
    };
};

const toPaymentIntentDto = (intent, { requiredConfirmations } = {}) => {
    if (!intent) return null;

    return {
        id: String(intent._id || intent.id),
        status: intent.status,
        packageId: intent.packageId,
        paymentMethodId: intent.paymentMethodId,
        namespace: intent.namespace || intent.paymentMethodSnapshot?.namespace || "eip155",
        paymentMethod: intent.paymentMethodSnapshot ? {
            id: intent.paymentMethodSnapshot.id,
            name: intent.paymentMethodSnapshot.name,
            namespace: intent.paymentMethodSnapshot.namespace || "eip155",
            network: intent.paymentMethodSnapshot.network,
            networkId: intent.paymentMethodSnapshot.networkId,
            caipNetworkId: intent.paymentMethodSnapshot.namespace === "solana"
                ? `solana:${intent.paymentMethodSnapshot.networkId}`
                : `eip155:${intent.paymentMethodSnapshot.chainId}`,
            cluster: intent.paymentMethodSnapshot.cluster || null,
            chainId: intent.paymentMethodSnapshot.chainId,
            token: {
                address: intent.paymentMethodSnapshot.tokenAddress || intent.paymentMethodSnapshot.mintAddress,
                mintAddress: intent.paymentMethodSnapshot.mintAddress || null,
                symbol: intent.paymentMethodSnapshot.tokenSymbol,
                decimals: intent.paymentMethodSnapshot.tokenDecimals,
                assetType: intent.paymentMethodSnapshot.assetType || "erc20"
            },
            recipientAddress: intent.paymentMethodSnapshot.treasuryAddress,
            confirmations: intent.paymentMethodSnapshot.confirmations
        } : null,
        networkId: intent.networkId || null,
        chainId: intent.chainId,
        token: {
            address: intent.tokenAddress || intent.mintAddress,
            mintAddress: intent.mintAddress || null,
            symbol: intent.tokenSymbol,
            decimals: intent.tokenDecimals,
            assetType: intent.paymentMethodSnapshot?.assetType || "erc20"
        },
        recipientAddress: intent.recipientAddress,
        expectedTokenAmountBaseUnits: intent.expectedTokenAmountBaseUnits,
        expectedUsdAmountMinor: intent.expectedUsdAmountMinor,
        creditAmount: intent.creditAmount,
        pricingVersion: intent.pricingVersion,
        payerAddress: intent.payerAddress || null,
        candidateTxHash: intent.candidateTxHash || null,
        txHash: intent.txHash || null,
        verifiedTokenAmountBaseUnits: intent.verifiedTokenAmountBaseUnits || null,
        confirmationCount: intent.confirmationCount ?? null,
        requiredConfirmations: intent.paymentMethodSnapshot?.confirmations ?? requiredConfirmations ?? null,
        expiresAt: intent.expiresAt || null,
        confirmedAt: intent.confirmedAt || null,
        credited: Boolean(intent.creditedTransactionId),
        failureCode: intent.failureCode || null,
        failureReason: intent.failureReason || null,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt
    };
};

const toPaymentPayerChallengeDto = (challenge) => {
    if (!challenge) return null;

    return {
        id: String(challenge._id || challenge.id),
        payerAddress: challenge.payerAddress,
        message: challenge.message,
        expiresAt: challenge.expiresAt
    };
};

const toWalletDto = (wallet) => {
    if (!wallet) return null;

    const balance = wallet.balance || 0;
    const reserved = wallet.reserved || 0;

    return {
        id: String(wallet._id || wallet.id),
        balance,
        reserved,
        available: Math.max(balance - reserved, 0),
        unit: wallet.unit
    };
};

const toPaymentSettlementDto = (settlement) => {
    if (!settlement) return null;

    return {
        settled: Boolean(settlement.settled),
        created: Boolean(settlement.created),
        paymentIntent: settlement.paymentIntent ? {
            id: settlement.paymentIntent.id,
            status: settlement.paymentIntent.status,
            creditedTransactionId: settlement.paymentIntent.creditedTransactionId,
            overpaidAmountBaseUnits: settlement.paymentIntent.overpaidAmountBaseUnits || null,
            confirmedAt: settlement.paymentIntent.confirmedAt || null
        } : null,
        wallet: settlement.wallet ? {
            id: settlement.wallet.id,
            balance: settlement.wallet.balance,
            reserved: settlement.wallet.reserved,
            unit: settlement.wallet.unit
        } : null,
        transaction: settlement.transaction ? {
            id: settlement.transaction.id,
            type: settlement.transaction.type,
            amount: settlement.transaction.amount,
            paymentIntentId: settlement.transaction.paymentIntentId,
            namespace: settlement.transaction.namespace,
            networkId: settlement.transaction.networkId,
            chainId: settlement.transaction.chainId,
            txHash: settlement.transaction.txHash
        } : null
    };
};

const toPaymentPackageDto = (paymentPackage) => {
    if (!paymentPackage) return null;

    return {
        packageId: paymentPackage.packageId,
        creditAmount: paymentPackage.creditAmount,
        expectedUsdAmountMinor: paymentPackage.expectedUsdAmountMinor,
        expectedTokenAmountBaseUnits: paymentPackage.expectedTokenAmountBaseUnits,
        pricingVersion: paymentPackage.pricingVersion
    };
};

const toPaymentMethodDto = (paymentMethod) => {
    if (!paymentMethod) return null;

    return {
        id: paymentMethod.id,
        name: paymentMethod.name,
        namespace: paymentMethod.namespace || "eip155",
        network: paymentMethod.network,
        networkId: paymentMethod.networkId || null,
        chainId: paymentMethod.chainId,
        cluster: paymentMethod.cluster || null,
        caipNetworkId: paymentMethod.namespace === "solana"
            ? `solana:${paymentMethod.networkId}`
            : `eip155:${paymentMethod.chainId}`,
        testnet: paymentMethod.production === false,
        enabled: paymentMethod.enabled !== false,
        token: {
            address: paymentMethod.tokenAddress || paymentMethod.mintAddress,
            mintAddress: paymentMethod.mintAddress || null,
            symbol: paymentMethod.tokenSymbol,
            decimals: paymentMethod.tokenDecimals,
            assetType: paymentMethod.assetType || "erc20"
        }
    };
};

module.exports = {
    toSafeUser,
    toPromptDto,
    toBotRunDto,
    toPaymentIntentDto,
    toPaymentPayerChallengeDto,
    toWalletDto,
    toPaymentSettlementDto,
    toPaymentPackageDto,
    toPaymentMethodDto
};
