
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStatus } from "../hooks/useAuthStatus";
import { fetchBotRun, fetchStartBot } from "../services/botService";
import { validateChannelTheme, validateVideoUrl } from "../validate/validateInputs";
import { fetchUserPrompt, fetchSaveTheme, fetchSaveGender, generateBotPrompt } from "../services/promptService";
import Gender from "../components/Gender";
import Theme from "../components/Theme";
import BotStarter from "../components/BotStarter";
import Header from "../components/Header";
import LanguageSwitcher from "../components/LanguageSwitcher";
import Loading from "../components/Loading";
import VideoListButton from "../components/VideoListButton";
import WalletPanel from "../components/WalletPanel";
import styles from "../styles/dashboard.module.css";

const Dashboard = () => {
    const [videoUrl, setVideoUrl] = useState("");
    const [channelTheme, setChannelTheme] = useState("");
    const [botGender, setBotGender] = useState("male");
    const [isBotRunning, setIsBotRunning] = useState(false);
    const [error, setError] = useState({ videoUrl: false, channelTheme: false });
    const [savedTheme, setSavedTheme] = useState(null);
    const [savedGender, setSavedGender] = useState(null);
    const [isEditingTheme, setIsEditingTheme] = useState(false);
    const [isEditingGender, setIsEditingGender] = useState(false);
    const [botRun, setBotRun] = useState(null);
    const { t } = useTranslation();
    const isConnected = useAuthStatus(null, "/");

    useEffect(() => {
        const getUserPrompt = async () => {
            const promptData = await fetchUserPrompt(setSavedTheme, setSavedGender);
            if (promptData) {
                setSavedTheme(promptData.channelTheme);
                setSavedGender(promptData.genderText);
            }
        };
        getUserPrompt();
    }, []);

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

    const startBot = async () => {
        const videoOk = validateVideoUrl(videoUrl, setError);
        const themeOk = validateChannelTheme(savedTheme || channelTheme, setError);
        if (!videoOk || !themeOk) return;

        const prompt = generateBotPrompt(botGender, savedTheme, channelTheme);
        if (!prompt) return;

        const result = await fetchStartBot(videoUrl, prompt, botGender, setIsBotRunning);
        if (result.run) {
            setBotRun(result.run);
        }
        alert(result.message);

        setVideoUrl("");
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

            <WalletPanel />

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

            <VideoListButton />

            <BotStarter {...{
                error,
                videoUrl,
                setVideoUrl,
                startBot,
                isBotRunning
            }} />
            {botRun && (
                <p>
                    Bot run: {botRun.status}. Replies: {botRun.successCount}, failed: {botRun.failureCount}, skipped: {botRun.skippedCount}.
                </p>
            )}
        </div>
    );
};

export default Dashboard;
