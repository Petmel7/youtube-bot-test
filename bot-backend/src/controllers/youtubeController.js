
const { getUserChannelId, getChannelVideos } = require("../services/youtubeService");
const { validateYoutubeVideosQuery } = require("../utils/validators");

const fetchUserVideos = async (req, res) => {
    const user = req.user;
    const { maxResults, pageToken } = validateYoutubeVideosQuery(req.query);
    const channelId = await getUserChannelId(user);
    const result = await getChannelVideos(user, channelId, { maxResults, pageToken });

    res.json({ success: true, ...result });
};

module.exports = { fetchUserVideos };
