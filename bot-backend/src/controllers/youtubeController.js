
const { getUserChannelId, getChannelVideos } = require("../services/youtubeService");

const fetchUserVideos = async (req, res) => {
    const user = req.user;
    const channelId = await getUserChannelId(user);
    const videos = await getChannelVideos(user, channelId);

    res.json({ success: true, videos });
};

module.exports = { fetchUserVideos };
