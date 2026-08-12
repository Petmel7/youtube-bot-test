const User = require("../models/User");
const { google } = require("googleapis");
const { googleClientId, googleClientSecret, googleRedirectUri } = require("../config/config");
const { forbidden, unauthorized, upstream } = require("../utils/errors");

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

async function getValidAccessToken(user) {
    if (!user.tokens.refresh_token) {
        throw forbidden("YOUTUBE_NOT_CONNECTED", "YouTube authorization is required");
    }

    if (user.tokens.expiry_date < Date.now()) {
        const oauth2Client = new google.auth.OAuth2(googleClientId, googleClientSecret, googleRedirectUri);
        oauth2Client.setCredentials({ refresh_token: user.tokens.refresh_token });

        try {
            const { credentials } = await oauth2Client.refreshAccessToken();

            await User.findByIdAndUpdate(user._id, {
                tokens: {
                    access_token: credentials.access_token,
                    refresh_token: user.tokens.refresh_token,
                    expiry_date: Date.now() + 3600 * 1000
                }
            });

            return credentials.access_token;
        } catch (error) {
            if (error.response?.data?.error === "invalid_grant") {
                await User.findByIdAndUpdate(user._id, { $unset: { tokens: "" } });
                throw unauthorized("YouTube authorization expired. Please reconnect.");
            }

            throw upstream("GOOGLE_TOKEN_REFRESH_FAILED", "Failed to refresh YouTube authorization");
        }
    }

    return user.tokens.access_token;
};

module.exports = {
    findUserById,
    storeUserTokensInSession,
    getValidAccessToken
};
