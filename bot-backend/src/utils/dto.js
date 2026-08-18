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
        chainId: intent.chainId,
        token: {
            address: intent.tokenAddress,
            symbol: intent.tokenSymbol,
            decimals: intent.tokenDecimals
        },
        recipientAddress: intent.recipientAddress,
        expectedTokenAmountBaseUnits: intent.expectedTokenAmountBaseUnits,
        expectedUsdAmountMinor: intent.expectedUsdAmountMinor,
        creditAmount: intent.creditAmount,
        pricingVersion: intent.pricingVersion,
        txHash: intent.txHash || null,
        verifiedTokenAmountBaseUnits: intent.verifiedTokenAmountBaseUnits || null,
        confirmationCount: intent.confirmationCount ?? null,
        requiredConfirmations: requiredConfirmations ?? null,
        expiresAt: intent.expiresAt || null,
        confirmedAt: intent.confirmedAt || null,
        credited: Boolean(intent.creditedTransactionId),
        failureCode: intent.failureCode || null,
        failureReason: intent.failureReason || null,
        createdAt: intent.createdAt,
        updatedAt: intent.updatedAt
    };
};

module.exports = { toSafeUser, toPromptDto, toBotRunDto, toPaymentIntentDto };
