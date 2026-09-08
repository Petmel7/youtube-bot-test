const User = require("../models/User");
const { google } = require("googleapis");
const { googleClientId, googleClientSecret, googleRedirectUri } = require("../config/config");
const { forbidden, unauthorized, upstream } = require("../utils/errors");
const { encryptToken, decryptToken } = require("./security/tokenCrypto");

const TOKEN_SELECT = "+tokens.access_token +tokens.refresh_token +tokens.scope +tokens.token_type +tokens.expiry_date";

const findUserById = async (userId) => {
    try {
        return await User.findById(userId);
    } catch (error) {
        throw error;
    }
};

const storeUserTokensInSession = (req, userId) => {
    req.session.userId = String(userId);
};

const selectTokenFields = (queryOrPromise) => (
    queryOrPromise && typeof queryOrPromise.select === "function"
        ? queryOrPromise.select(TOKEN_SELECT)
        : queryOrPromise
);

const findUserWithTokensById = async (userId) => selectTokenFields(User.findById(userId));

const decryptUserTokens = (user) => {
    if (!user?.tokens) return null;

    return {
        access_token: decryptToken(user.tokens.access_token),
        refresh_token: decryptToken(user.tokens.refresh_token),
        scope: user.tokens.scope || null,
        token_type: user.tokens.token_type || null,
        expiry_date: user.tokens.expiry_date || 0
    };
};

const encryptUserTokens = ({ accessToken, refreshToken, expiryDate, scope, tokenType }) => ({
    access_token: encryptToken(accessToken),
    refresh_token: encryptToken(refreshToken),
    ...(scope ? { scope } : {}),
    ...(tokenType ? { token_type: tokenType } : {}),
    expiry_date: expiryDate
});

const hasYouTubeConnection = async (userOrId) => {
    const userId = userOrId?._id || userOrId?.id || userOrId;
    if (!userId) return false;

    const userWithTokens = userOrId?.tokens?.refresh_token || userOrId?.tokens?.access_token
        ? userOrId
        : await findUserWithTokensById(userId);
    const tokens = decryptUserTokens(userWithTokens);

    return Boolean(tokens?.refresh_token || tokens?.access_token);
};

async function getValidAccessToken(user) {
    const userId = user?._id || user?.id || user;
    const userWithTokens = user?.tokens?.refresh_token || user?.tokens?.access_token
        ? user
        : await findUserWithTokensById(userId);
    const tokens = decryptUserTokens(userWithTokens);

    if (!tokens?.refresh_token) {
        throw forbidden("YOUTUBE_NOT_CONNECTED", "YouTube authorization is required");
    }

    if (!tokens.access_token || tokens.expiry_date < Date.now()) {
        const oauth2Client = new google.auth.OAuth2(googleClientId, googleClientSecret, googleRedirectUri);
        oauth2Client.setCredentials({ refresh_token: tokens.refresh_token });

        try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            const refreshedAccessToken = credentials.access_token;
            const expiryDate = credentials.expiry_date || Date.now() + 3600 * 1000;

            await User.findByIdAndUpdate(userId, {
                $set: {
                    tokens: encryptUserTokens({
                        accessToken: refreshedAccessToken,
                        refreshToken: tokens.refresh_token,
                        expiryDate,
                        scope: credentials.scope || tokens.scope,
                        tokenType: credentials.token_type || tokens.token_type
                    })
                }
            });

            return refreshedAccessToken;
        } catch (error) {
            if (error.response?.data?.error === "invalid_grant") {
                await User.findByIdAndUpdate(userId, { $unset: { tokens: "" } });
                throw unauthorized("YouTube authorization expired. Please reconnect.");
            }

            throw upstream("GOOGLE_TOKEN_REFRESH_FAILED", "Failed to refresh YouTube authorization");
        }
    }

    return tokens.access_token;
};

module.exports = {
    findUserById,
    findUserWithTokensById,
    storeUserTokensInSession,
    encryptUserTokens,
    decryptUserTokens,
    hasYouTubeConnection,
    getValidAccessToken
};
