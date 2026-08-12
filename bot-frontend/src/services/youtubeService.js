import { apiRequest } from "./api";

export const fetchMyVideos = async () => {
    try {
        const data = await apiRequest("/youtube/my-videos");
        if (data.success) {
            return { success: true, videos: data.videos };
        } else {
            return { success: false, videos: [], error: data.error };
        }
    } catch (err) {
        return { success: false, videos: [], error: err };
    }
};
