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

module.exports = { toSafeUser, toPromptDto, toBotRunDto };
