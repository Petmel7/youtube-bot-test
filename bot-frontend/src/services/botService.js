
import { apiRequest, createIdempotencyKey } from "./api";
import { fetchAddTheme, fetchGetTheme } from "./promptService";

export const fetchStartBot = async (videoUrl, prompt, botGender, setIsBotRunning) => {
    const extractVideoId = (url) => {
        const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
        return match ? match[1] : null;
    };

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
        console.warn("❌ Невірний формат посилання!");
        return { success: false, message: "Invalid video URL format!" };
    }

    setIsBotRunning(true);

    try {
        let savedTheme = await fetchGetTheme();
        if (!savedTheme) {
            savedTheme = await fetchAddTheme(prompt.channelTheme, botGender);
            if (!savedTheme) {
                console.warn("❌ Не вдалося додати тематику каналу.");
                setIsBotRunning(false);
                return { success: false, message: "Failed to add channel theme!" };
            }
        }

        const data = await apiRequest("/bot/start", {
            method: "POST",
            body: JSON.stringify({
                videoId,
                prompt: savedTheme?.generalPrompt || "",
                idempotencyKey: createIdempotencyKey()
            })
        });

        return { success: data.success, message: "Bot run started.", run: data.run };
    } catch (error) {
        setIsBotRunning(false);
        return { success: false, message: error.message || "Error starting bot!" };
    }
};

export const fetchBotRun = async (runId) => {
    const data = await apiRequest(`/bot/runs/${runId}`);
    return data.run;
};

