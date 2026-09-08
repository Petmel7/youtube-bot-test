
const { fetchAllUsers } = require("../services/userService");
const { hasYouTubeConnection } = require("../services/authService");
const { toSafeUser } = require("../utils/dto");

const getUsers = async (req, res) => {
    const users = await fetchAllUsers();
    res.json({ success: true, users: users.map(toSafeUser) });
};

const getUser = async (req, res) => {
    const youtubeConnected = await hasYouTubeConnection(req.user);
    const userObject = req.user.toObject?.() || req.user;
    res.json({ success: true, user: toSafeUser({ ...userObject, youtubeConnected }) });
};

const getUserRole = async (req, res) => {
    res.json({ success: true, user: { role: req.user.role } });
};

module.exports = { getUserRole, getUsers, getUser };
