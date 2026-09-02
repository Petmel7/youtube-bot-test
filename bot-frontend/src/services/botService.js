
import { apiRequest, createIdempotencyKey } from "./api";
import { fetchAddTheme, fetchGetTheme } from "./promptService";

export const fetchStartBot = async (videoId, prompt, botGender, setIsBotRunning) => {
    if (!videoId) {
        return { success: false, message: "Select a video first." };
    }

    setIsBotRunning(true);
    let savedPrompt = null;

    try {
        savedPrompt = await fetchGetTheme();
        if (!savedPrompt) {
            savedPrompt = await fetchAddTheme(prompt.channelTheme, botGender);
            if (!savedPrompt) {
                console.warn("❌ Не вдалося додати тематику каналу.");
                setIsBotRunning(false);
                return { success: false, message: "Failed to add channel theme!" };
            }
        }

        const data = await apiRequest("/bot/start", {
            method: "POST",
            body: JSON.stringify({
                videoId,
                prompt: savedPrompt?.generalPrompt || "",
                idempotencyKey: createIdempotencyKey()
            })
        });

        return { success: data.success, message: "Bot run started.", run: data.run, prompt: savedPrompt };
    } catch (error) {
        setIsBotRunning(false);
        return {
            success: false,
            code: error.code,
            details: error.details,
            prompt: savedPrompt,
            message: error.message || "Error starting bot!"
        };
    }
};

export const fetchBotCostEstimate = async (prompt) => {
    const data = await apiRequest("/bot/cost-estimate", {
        method: "POST",
        body: JSON.stringify({ prompt: prompt || "" })
    });
    return data.cost;
};

export const fetchBotRun = async (runId) => {
    const data = await apiRequest(`/bot/runs/${runId}`, {
        cache: "no-store",
        headers: {
            "Cache-Control": "no-cache"
        }
    });
    return data.run;
};

