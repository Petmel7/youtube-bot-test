
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { fetchBotCostEstimate, fetchBotRun, fetchStartBot } from "../services/botService";
import { validateChannelTheme } from "../validate/validateInputs";
import { fetchUserPrompt, fetchSaveTheme, fetchSaveGender, generateBotPrompt } from "../services/promptService";
import { fetchWallet } from "../services/paymentService";
import Gender from "../components/Gender";
import Theme from "../components/Theme";
import BotStarter from "../components/BotStarter";
import Header from "../components/Header";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Loading from "../components/Loading";
import BotRunActivity from "../components/BotRunActivity";
import MyVideos from "../components/MyVideos";
import WalletPanel from "../components/WalletPanel";
import styles from "../styles/dashboard.module.css";

const ACTIVE_BOT_RUN_STATUSES = new Set(["queued", "running"]);
const TERMINAL_BOT_RUN_STATUSES = new Set(["completed", "partial", "failed", "cancelled"]);
const MAX_POLL_FAILURES = 3;
const BOT_RUN_STILL_PROCESSING_MS = 30000;
const BOT_RUN_MAX_POLLING_MS = 10 * 60 * 1000;

const Dashboard = () => {
    const [selectedVideo, setSelectedVideo] = useState(null);
    const [channelTheme, setChannelTheme] = useState("");
    const [botGender, setBotGender] = useState("male");
    const [isBotRunning, setIsBotRunning] = useState(false);
    const [error, setError] = useState({ channelTheme: false, selectedVideo: false });
    const [notice, setNotice] = useState("");
    const [savedTheme, setSavedTheme] = useState(null);
    const [savedGender, setSavedGender] = useState(null);
    const [isEditingTheme, setIsEditingTheme] = useState(false);
    const [isEditingGender, setIsEditingGender] = useState(false);
    const [botRun, setBotRun] = useState(null);
    const [walletAvailable, setWalletAvailable] = useState(null);
    const [botCostEstimate, setBotCostEstimate] = useState(null);
    const [estimateLoading, setEstimateLoading] = useState(false);
    const pollStartedAtRef = useRef(null);
    const { t } = useTranslation();
    const isConnected = useAuthStatus(null, "/");

    useEffect(() => {
        const getUserPrompt = async () => {
            const promptData = await fetchUserPrompt(setSavedTheme, setSavedGender);
            if (promptData) {
                setSavedTheme(promptData.channelTheme);
                setSavedGender(promptData.gender);
            }
        };
        getUserPrompt();
    }, []);

    const loadWalletSummary = useCallback(async () => {
        try {
            const wallet = await fetchWallet();
            setWalletAvailable(wallet?.available ?? null);
        } catch (error) {
            setWalletAvailable(null);
        }
    }, []);

    useEffect(() => {
        loadWalletSummary();
    }, [loadWalletSummary]);

    const botRunId = botRun?.id;
    const botRunStatus = botRun?.status;

    useEffect(() => {
        if (!botRunId) return;
        if (TERMINAL_BOT_RUN_STATUSES.has(botRunStatus)) {
            setIsBotRunning(false);
            pollStartedAtRef.current = null;
            return;
        }
        if (!ACTIVE_BOT_RUN_STATUSES.has(botRunStatus)) return;

        let stopped = false;
        let timerId;
        let consecutiveFailures = 0;
        pollStartedAtRef.current = pollStartedAtRef.current || Date.now();

        const poll = async () => {
            const elapsedMs = Date.now() - pollStartedAtRef.current;
            if (elapsedMs > BOT_RUN_MAX_POLLING_MS) {
                setIsBotRunning(false);
                setNotice(t("bot.pollingTimedOut"));
                return;
            }

            try {
                const run = await fetchBotRun(botRunId);
                if (stopped) return;

                setBotRun(run);
                consecutiveFailures = 0;
                if (TERMINAL_BOT_RUN_STATUSES.has(run.status)) {
                    setIsBotRunning(false);
                    pollStartedAtRef.current = null;
                    return;
                }
                if (elapsedMs > BOT_RUN_STILL_PROCESSING_MS) {
                    setNotice(t("bot.stillProcessing"));
                }
            } catch (error) {
                if (stopped) return;
                consecutiveFailures += 1;
                if (consecutiveFailures >= MAX_POLL_FAILURES) {
                    setIsBotRunning(false);
                    setNotice(t("bot.pollingFailed"));
                    return;
                }
            }

            timerId = setTimeout(poll, 3000);
        };

        timerId = setTimeout(poll, 3000);

        return () => {
            stopped = true;
            clearTimeout(timerId);
        };
    }, [botRunId, botRunStatus, t]);

    const saveTheme = async () => {
        if (!validateChannelTheme(channelTheme, setError)) return;
        await fetchSaveTheme(channelTheme, setSavedTheme, setIsEditingTheme);
    };


    const saveGender = async () => {
        await fetchSaveGender(botGender, setSavedGender, setIsEditingGender);
    };

    const handleSelectVideo = (video) => {
        setSelectedVideo(video);
        setError(prev => ({ ...prev, selectedVideo: false }));
        setNotice("");
    };

    const botPrompt = useMemo(
        () => generateBotPrompt(botGender, savedTheme, channelTheme),
        [botGender, savedTheme, channelTheme]
    );
    const canStartBot = Boolean(selectedVideo?.videoId && (savedTheme || channelTheme).trim());

    useEffect(() => {
        let ignore = false;

        const loadCostEstimate = async () => {
            if (!botPrompt) {
                setBotCostEstimate(null);
                return;
            }

            setEstimateLoading(true);
            try {
                const estimate = await fetchBotCostEstimate(botPrompt.generalPrompt || "");
                if (!ignore) {
                    setBotCostEstimate(estimate);
                    setWalletAvailable(estimate.availableCredits ?? null);
                }
            } catch (error) {
                if (!ignore) setBotCostEstimate(null);
            } finally {
                if (!ignore) setEstimateLoading(false);
            }
        };

        loadCostEstimate();

        return () => {
            ignore = true;
        };
    }, [botPrompt]);

    const startBot = async () => {
        const videoOk = Boolean(selectedVideo?.videoId);
        setError(prev => ({ ...prev, selectedVideo: !videoOk }));
        const themeOk = validateChannelTheme(savedTheme || channelTheme, setError);
        if (!videoOk || !themeOk) return;

        if (!botPrompt) return;

        setNotice("");
        pollStartedAtRef.current = null;
        const result = await fetchStartBot(selectedVideo.videoId, botPrompt, botGender, setIsBotRunning);
        await loadWalletSummary();
        if (result.run) {
            setBotRun(result.run);
        }
        if (result.code === "INSUFFICIENT_CREDITS") {
            setBotCostEstimate(result.details || null);
            setWalletAvailable(result.details?.availableCredits ?? 0);
            setNotice(t("bot.insufficientCreditsDetailed", {
                required: result.details?.requiredCredits ?? "-",
                available: result.details?.availableCredits ?? "-"
            }));
        } else {
            setNotice(result.message);
        }

        setSavedTheme(channelTheme);
        setSavedGender(botGender);
    };

    const getBotRunErrorMessage = (run) => {
        const code = run?.topErrorCode || run?.errorCode;
        if (code === "GEMINI_TIMEOUT") return t("bot.aiTimeout");
        if (code === "GEMINI_REPLY_INCOMPLETE") return t("bot.aiIncomplete");
        if (code === "GEMINI_RATE_LIMIT") return t("bot.aiRateLimited");
        if (code === "GEMINI_PROVIDER_UNAVAILABLE") return t("bot.aiUnavailable");
        if (code === "GEMINI_PROVIDER_ERROR") return t("bot.aiProviderError");
        if (code === "GEMINI_AUTH_FAILED" || code === "GEMINI_INVALID_MODEL") {
            return t("bot.aiConfigError");
        }
        if (code === "INSUFFICIENT_CREDITS") {
            return t("bot.insufficientCredits");
        }

        return run?.topErrorMessage || run?.errorMessage || code;
    };

    if (isConnected === null) {
        return <Loading />;
    }

    return (
        <div className={styles.dashboardConteaner}>
            <LanguageSwitcher />
            <Header />

            <h1 className={styles.dashboardTitle}>YouTube {t('bot.dashboard')}</h1>

            <div className={styles.dashboardLayout}>
                <main className={styles.mainColumn}>
                    <div className={styles.mainPanel}>
                        <div className={styles.themeConteaner}>
                            <Gender {...{
                                isEditingGender,
                                botGender,
                                setBotGender,
                                savedGender,
                                saveGender,
                                setIsEditingGender
                            }} />

                            <Theme {...{
                                isEditingTheme,
                                error,
                                channelTheme,
                                setChannelTheme,
                                savedTheme,
                                saveTheme,
                                setIsEditingTheme
                            }} />
                        </div>

                        <MyVideos selectedVideo={selectedVideo} onSelectVideo={handleSelectVideo} />

                        <BotStarter {...{
                            error,
                            selectedVideo,
                            startBot,
                            isBotRunning,
                            notice,
                            canStartBot,
                            walletAvailable,
                            botCostEstimate,
                            estimateLoading
                        }} />
                        {botRun && (
                            <BotRunActivity
                                run={botRun}
                                videoTitle={selectedVideo?.title}
                                getErrorMessage={getBotRunErrorMessage}
                            />
                        )}
                    </div>
                </main>

                <aside className={styles.sidebarColumn}>
                    <WalletPanel />
                </aside>
            </div>
        </div>
    );
};

export default Dashboard;
