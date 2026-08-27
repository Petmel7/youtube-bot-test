const mongoose = require("mongoose");

const videoCatalogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    channelId: { type: String, required: true, index: true },
    videoId: { type: String, required: true },
    title: { type: String, required: true, default: "" },
    description: { type: String, required: true, default: "" },
    normalizedTitle: { type: String, required: true, default: "" },
    normalizedDescription: { type: String, required: true, default: "" },
    publishedAt: { type: Date, default: null },
    thumbnail: { type: String, default: null },
    duration: { type: String, default: null },
    views: { type: String, default: null },
    likes: { type: String, default: null },
    comments: { type: String, default: null },
    privacyStatus: { type: String, default: null },
    uploadStatus: { type: String, default: null },
    lastSyncedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

videoCatalogSchema.index({ userId: 1, videoId: 1 }, { unique: true });
videoCatalogSchema.index({ userId: 1, publishedAt: -1, _id: -1 });
videoCatalogSchema.index({ userId: 1, normalizedTitle: 1 });
videoCatalogSchema.index({ userId: 1, normalizedDescription: 1 });
videoCatalogSchema.index({ title: "text", description: "text" });

const VideoCatalog = mongoose.model("VideoCatalog", videoCatalogSchema, "videocatalog");

module.exports = VideoCatalog;
