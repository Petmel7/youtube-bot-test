
const { getUserChannelInfo, getChannelVideos } = require("../services/youtubeService");
const { validateYoutubeVideosQuery } = require("../utils/validators");

const fetchUserVideos = async (req, res) => {
    const user = req.user;
    const { maxResults, pageToken } = validateYoutubeVideosQuery(req.query);
    const { uploadsPlaylistId } = await getUserChannelInfo(user);
    const result = await getChannelVideos(user, uploadsPlaylistId, { maxResults, pageToken });

    res.json({ success: true, ...result });
};

module.exports = { fetchUserVideos };
