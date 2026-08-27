
const { getCatalogVideos, syncVideoCatalog } = require("../services/youtubeService");
const { validateYoutubeVideosQuery } = require("../utils/validators");

const fetchUserVideos = async (req, res) => {
    const user = req.user;
    const { maxResults, pageToken, searchQuery } = validateYoutubeVideosQuery(req.query);
    const result = await getCatalogVideos(user, { maxResults, pageToken, searchQuery });

    res.json({ success: true, ...result });
};

const refreshUserVideos = async (req, res) => {
    const result = await syncVideoCatalog(req.user);

    res.status(202).json({
        success: true,
        sync: {
            videosSynced: result.videosSynced,
            pagesSynced: result.pagesSynced,
            hasMore: result.hasMore,
            lastSyncedAt: result.lastSyncedAt.toISOString()
        }
    });
};

module.exports = { fetchUserVideos, refreshUserVideos };
