const mongoose = require("mongoose");
const { mongoUri } = require("./config");

const connectDB = async () => {
    try {
        await mongoose.connect(mongoUri);
        console.log("✅ Connected to MongoDB Atlas");
    } catch (err) {
        console.error("❌ MongoDB connection error:", err);
        process.exit(1);
    }
};

module.exports = connectDB;

