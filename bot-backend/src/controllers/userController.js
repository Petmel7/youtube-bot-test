
const { fetchAllUsers } = require("../services/userService");
const { toSafeUser } = require("../utils/dto");

const getUsers = async (req, res) => {
    const users = await fetchAllUsers();
    res.json({ success: true, users: users.map(toSafeUser) });
};

const getUser = async (req, res) => {
    res.json({ success: true, user: toSafeUser(req.user) });
};

const getUserRole = async (req, res) => {
    res.json({ success: true, user: { role: req.user.role } });
};

module.exports = { getUserRole, getUsers, getUser };
