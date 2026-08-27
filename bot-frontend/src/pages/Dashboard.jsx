
import { useCallback, useMemo, useState, useEffect } from "react";
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
import MyVideos from "../components/MyVideos";
import WalletPanel from "../components/WalletPanel";
import styles from "../styles/dashboard.module.css";

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

    useEffect(() => {
        if (!botRun || !["queued", "running"].includes(botRun.status)) return;

        const timerId = setInterval(async () => {
            try {
                const run = await fetchBotRun(botRun.id);
                setBotRun(run);
                if (!["queued", "running"].includes(run.status)) {
                    setIsBotRunning(false);
                    clearInterval(timerId);
                }
            } catch (error) {
                setIsBotRunning(false);
                clearInterval(timerId);
            }
        }, 3000);

        return () => clearInterval(timerId);
    }, [botRun]);

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
                            <>
                                <p className={styles.botRunStatus}>
                                    {t("bot.run.status", {
                                        title: selectedVideo?.title || botRun.videoId,
                                        status: botRun.status,
                                        replies: botRun.successCount,
                                        failed: botRun.failureCount,
                                        skipped: botRun.skippedCount
                                    })}
                                </p>
                                {botRun.errorCode && (
                                    <p className={styles.error}>
                                        {botRun.errorCode === "INSUFFICIENT_CREDITS"
                                            ? t("bot.insufficientCredits")
                                            : (botRun.errorMessage || botRun.errorCode)}
                                    </p>
                                )}
                            </>
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
