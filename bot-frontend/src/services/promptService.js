import { ApiError, apiRequest } from "./api";

const isMissingPromptError = (error) => (
    error instanceof ApiError &&
    error.status === 404 &&
    error.code === "PROMPT_NOT_FOUND"
);

export const fetchAddTheme = async (channelTheme, gender) => {
    if (!channelTheme || !gender) {
        console.warn("❌ Введіть тематику каналу та виберіть стать!");
        return null;
    }

    try {
        const data = await apiRequest("/user-prompt/add", {
            method: "POST",
            body: JSON.stringify({ channelTheme, gender })
        });
        return data.success ? data.prompt : null;
    } catch (error) {
        console.error("❌ Error adding channel theme:", error);
        return null;
    }
};

export const fetchSaveTheme = async (channelTheme, setSavedTheme, setIsEditingTheme) => {
    if (!channelTheme) {
        alert("❌ Enter a channel theme!");
        return;
    }

    try {
        const data = await apiRequest("/user-prompt/update", {
            method: "PUT",
            body: JSON.stringify({ channelTheme })
        });
        if (data.success) {
            setSavedTheme(channelTheme);
            setIsEditingTheme(false);
        } else {
            alert("❌ Failed to update channel theme.");
        }
    } catch (error) {
        console.error("❌ Error updating channel theme:", error);
    }
}

export const fetchUserPrompt = async (setSavedTheme, setSavedGender) => {
    try {
        const data = await apiRequest("/user-prompt", {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" }
        });
        if (data.success && data.prompt) {
            setSavedTheme(data.prompt.channelTheme);
            setSavedGender(data.prompt.gender);
            return data.prompt;
        }
    } catch (error) {
        if (isMissingPromptError(error)) {
            return null;
        }

        console.error("❌ Error fetching channel theme:", error);
    }

    return null;
};

// ✅ Отримати тематику каналу
export const fetchGetTheme = async () => {
    try {
        const data = await apiRequest("/user-prompt", {
            cache: "no-store",
            headers: { "Cache-Control": "no-cache" }
        });
        return data.prompt || null;
    } catch (error) {
        if (isMissingPromptError(error)) {
            return null;
        }

        console.error("❌ Error fetching channel theme:", error);
        return null;
    }
};

export const generateBotPrompt = (botGender, savedTheme, channelTheme) => {
    if (!botGender) {
        alert("❌ Please select bot identity (Male/Female).");
        return null;
    }

    return {
        channelTheme: savedTheme || channelTheme,
        gender: botGender
    };
};

export const fetchSaveGender = async (botGender, setSavedGender, setIsEditingGender) => {
    if (!botGender) {
        alert("❌ Select bot identity!");
        return;
    }

    try {
        const data = await apiRequest("/user-prompt/update-gender", {
            method: "PUT",
            body: JSON.stringify({ gender: botGender })
        });
        if (data.success) {
            setSavedGender(botGender);
            setIsEditingGender(false);
        } else {
            alert("❌ Failed to update bot gender.");
        }
    } catch (error) {
        console.error("❌ Error updating bot gender:", error);
    }
};




