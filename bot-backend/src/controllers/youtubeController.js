
const { getCatalogVideos, listVideoComments, syncVideoCatalog } = require("../services/youtubeService");
const { validateVideoId, validateYoutubeCommentsQuery, validateYoutubeVideosQuery } = require("../utils/validators");

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

const fetchVideoComments = async (req, res) => {
    const videoId = validateVideoId(req.params.videoId);
    const query = validateYoutubeCommentsQuery(req.query);
    const result = await listVideoComments(req.user, videoId, query);

    res.json({ success: true, ...result });
};

module.exports = { fetchUserVideos, refreshUserVideos, fetchVideoComments };
