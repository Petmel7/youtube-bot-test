
const { getUserChannelInfo, getChannelVideos, searchChannelVideos } = require("../services/youtubeService");
const { validateYoutubeVideosQuery } = require("../utils/validators");

const fetchUserVideos = async (req, res) => {
    const user = req.user;
    const { maxResults, pageToken, searchQuery } = validateYoutubeVideosQuery(req.query);
    const { channelId, uploadsPlaylistId } = await getUserChannelInfo(user);
    const result = searchQuery
        ? await searchChannelVideos(user, channelId, searchQuery, { maxResults, pageToken })
        : await getChannelVideos(user, uploadsPlaylistId, { maxResults, pageToken });

    res.json({ success: true, ...result });
};

module.exports = { fetchUserVideos };
