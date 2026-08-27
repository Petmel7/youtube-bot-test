import { apiRequest } from "./api";

export const fetchMyVideos = async ({ pageToken, maxResults, query } = {}) => {
    try {
        const params = new URLSearchParams();
        if (pageToken) params.set("pageToken", pageToken);
        if (maxResults) params.set("maxResults", String(maxResults));
        if (query) params.set("query", query);

        const queryString = params.toString();
        const data = await apiRequest(`/youtube/my-videos${queryString ? `?${queryString}` : ""}`);
        if (data.success) {
            return {
                success: true,
                videos: data.videos || [],
                nextPageToken: data.nextPageToken || null,
                prevPageToken: data.prevPageToken || null,
                pageInfo: data.pageInfo || {}
            };
        } else {
            return { success: false, videos: [], nextPageToken: null, prevPageToken: null, pageInfo: {}, error: data.error };
        }
    } catch (err) {
        return { success: false, videos: [], nextPageToken: null, prevPageToken: null, pageInfo: {}, error: err };
    }
};

export const refreshMyVideos = async () => {
    try {
        const data = await apiRequest("/youtube/my-videos/refresh", { method: "POST" });
        return { success: true, sync: data.sync || null };
    } catch (err) {
        return { success: false, error: err };
    }
};
