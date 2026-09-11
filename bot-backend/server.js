
const express = require("express");
const passport = require("passport");
require("dotenv").config();

// ✅ Імпорти конфігурацій
const connectDB = require("./src/config/db");
const sessionMiddleware = require("./src/config/session");
const corsMiddleware = require("./src/config/cors");
const validateEnv = require("./src/config/validateEnv");
const errorHandler = require("./src/middleware/errorHandler");
const healthRoutes = require("./src/routes/healthRoutes");
const { getCsrfToken } = require("./src/controllers/csrfController");
const { createConfiguredRateLimiters } = require("./src/middleware/rateLimiters");
const {
    botRunRecoveryOnStartup,
    botRunRecoveryIntervalMs
} = require("./src/config/config");
const {
    runBotRunRecoveryOnce,
    startBotRunRecoveryLoop,
    toSafeRecoveryErrorLog
} = require("./src/services/botRunRecoveryService");

validateEnv();

// ✅ Підключення Passport конфігурації
require("./src/config/passport");

// ✅ Імпорти маршрутів
const authRoutes = require("./src/routes/authRoutes");
const botRoutes = require("./src/routes/botRoutes");
const userRoutes = require("./src/routes/userRoutes");
const userPromptRoutes = require("./src/routes/userPromptRoutes");
const youtubeRoutes = require("./src/routes/youtubeRoutes");
const paymentRoutes = require("./src/routes/paymentRoutes");
const adminRoutes = require("./src/routes/adminRoutes");

// ✅ Ініціалізація додатку
const app = express();
const rateLimiters = createConfiguredRateLimiters();

app.set('trust proxy', 1);

app.use(healthRoutes);

// ✅ Налаштування middleware
app.use(corsMiddleware);
app.use(express.json());
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

app.get("/csrf-token", getCsrfToken);
app.use(rateLimiters.global);

app.get("/", (req, res) => {
    res.send("✅ YouTube Bot Backend is running!");
});

// ✅ Підключення роутів
app.use("/auth", rateLimiters.auth, authRoutes);
app.use("/bot", rateLimiters.bot, botRoutes);
app.use("/user", userRoutes);
app.use("/user-prompt", userPromptRoutes);
app.use("/youtube", rateLimiters.youtube, youtubeRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", rateLimiters.admin, adminRoutes);
app.use(errorHandler);

const PORT = process.env.PORT || 10000;
let stopBotRunRecoveryLoop = null;

const startServer = async () => {
    await connectDB();

    const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

    if (botRunRecoveryOnStartup) {
        setImmediate(async () => {
            try {
                const summary = await runBotRunRecoveryOnce();
                console.log("Bot run startup recovery completed", summary);
            } catch (error) {
                console.error("Bot run startup recovery failed", toSafeRecoveryErrorLog(error, "BOT_RUN_RECOVERY_FAILED"));
            }
        });
        stopBotRunRecoveryLoop = startBotRunRecoveryLoop({ intervalMs: botRunRecoveryIntervalMs });
    }

    const stopServer = () => {
        if (stopBotRunRecoveryLoop) {
            stopBotRunRecoveryLoop();
        }
        server.close(() => process.exit(0));
    };

    process.on("SIGTERM", stopServer);
    process.on("SIGINT", stopServer);
};

startServer();
