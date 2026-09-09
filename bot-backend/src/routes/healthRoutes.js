const express = require("express");
const mongoose = require("mongoose");

const createHealthRoutes = ({ connection = mongoose.connection } = {}) => {
    const healthRouter = express.Router();

    healthRouter.get("/healthz", (req, res) => {
        res.json({ status: "ok" });
    });

    healthRouter.get("/readyz", (req, res) => {
        if (connection.readyState === 1) {
            return res.json({ status: "ready" });
        }

        return res.status(503).json({ status: "not_ready" });
    });

    return healthRouter;
};

module.exports = createHealthRoutes();
module.exports.createHealthRoutes = createHealthRoutes;
