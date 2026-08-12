
import { apiRequest } from "./api";

export const fetchAuthStatus = async () => {
    try {
        return await apiRequest("/auth/status");
    } catch (error) {
        console.error("❌ Fetch auth status error:", error);
        return { connected: false };
    }
};

export const fetchLogout = async () => {
    try {
        await apiRequest("/auth/logout", { method: "POST" });
        return { ok: true };
    } catch (error) {
        console.error("❌ Error during logout:", error);
    }
};
