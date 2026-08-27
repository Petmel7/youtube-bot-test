import { apiRequest } from "./api";

export const fetchMyVideos = async ({ pageToken, maxResults } = {}) => {
    try {
        const params = new URLSearchParams();
        if (pageToken) params.set("pageToken", pageToken);
        if (maxResults) params.set("maxResults", String(maxResults));

        const query = params.toString();
        const data = await apiRequest(`/youtube/my-videos${query ? `?${query}` : ""}`);
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
