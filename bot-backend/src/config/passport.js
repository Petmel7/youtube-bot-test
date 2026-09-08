
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");
const { decryptUserTokens, encryptUserTokens } = require("../services/authService");
const {
    googleClientId,
    googleClientSecret,
    googleRedirectUri
} = require("../config/config");

const upsertGoogleOAuthUser = async ({ accessToken, refreshToken, profile }) => {
    let user = await User.findOne({ googleId: profile.id })
        .select("+tokens.refresh_token +tokens.scope +tokens.token_type +tokens.expiry_date");

    const existingTokens = decryptUserTokens(user);
    const effectiveRefreshToken = refreshToken || existingTokens?.refresh_token;

    if (!effectiveRefreshToken) {
        throw new Error("❌ Відсутній refresh_token! Видаліть токени та авторизуйтесь знову.");
    }

    const expiryDate = Date.now() + 3600 * 1000;
    const encryptedTokens = encryptUserTokens({
        accessToken,
        refreshToken: effectiveRefreshToken,
        expiryDate
    });

    user = await User.findOneAndUpdate(
        { googleId: profile.id },
        {
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            picture: profile.photos[0].value,
            tokens: encryptedTokens
        },
        { upsert: true, new: true }
    );

    return User.findById(user._id);
};

passport.use(
    new GoogleStrategy(
        {
            clientID: googleClientId,
            clientSecret: googleClientSecret,
            callbackURL: googleRedirectUri
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                const user = await upsertGoogleOAuthUser({
                    accessToken,
                    refreshToken,
                    profile
                });
                return done(null, user);
            } catch (error) {
                return done(error, null);
            }
        }
    )
);

// ✅ Серіалізація та десеріалізація користувачів
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

module.exports = passport;
module.exports.upsertGoogleOAuthUser = upsertGoogleOAuthUser;
