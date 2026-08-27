
import { apiRequest, createIdempotencyKey } from "./api";
import { fetchAddTheme, fetchGetTheme } from "./promptService";

export const fetchStartBot = async (videoId, prompt, botGender, setIsBotRunning) => {
    if (!videoId) {
        return { success: false, message: "Select a video first." };
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
        return {
            success: false,
            code: error.code,
            message: error.message || "Error starting bot!"
        };
    }
};

export const fetchBotRun = async (runId) => {
    const data = await apiRequest(`/bot/runs/${runId}`);
    return data.run;
};

