const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    picture: { type: String },
    role: { type: String, required: true, default: "user" },
    tokens: {
        access_token: { type: String, select: false },
        refresh_token: { type: String, select: false },
        scope: { type: String, select: false },
        token_type: { type: String, select: false },
        expiry_date: { type: Number, select: false }
    }
}, { timestamps: true });

const User = mongoose.model("User", userSchema, "users");

module.exports = User;
