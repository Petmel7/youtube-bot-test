const User = require("../models/User");

const fetchAllUsers = async () => {
    return User.find({}, "name email picture role createdAt");
};

module.exports = { fetchAllUsers };
