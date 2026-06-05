import express from 'express';
import dotenv from 'dotenv';
import { connectDB, disconnectDB } from './db/config.js';
import userRoutes from './routes/userRoutes.js';
import { RedisClient } from 'redis';
import './cache/redis.js';
import { disconnectCache } from './cache/redis.js';
dotenv.config();
const app = express();
app.use(express.json());
app.use("/v1", userRoutes);



const start = async () => {
    await connectDB();

    const port = process.env.PORT || 3000;
    const server = app.listen(port, () => {
        console.log(`API running on port ${port}`);
    });
    app.get("/", (req, res) => {
        res.json({
            dockerCompose: "Node API with MongoDB and Redis",
            timestamp: new Date().toISOString()
        });
    });
    app.get("/health", (req, res) => {
        res.json({ status: "ok", timestamp: new Date().toISOString() });
    });


    const shutdown = async (signal) => {
        console.log(`Received ${signal}. Shutting down gracefully...`);
        server.close(async () => {
            await disconnectCache();
            await disconnectDB();
            console.log("All connections closed. Exiting.");
            process.exit(0);
        });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
};

start().catch((err) => {
    console.error("Startup failed:", err.message);
    process.exit(1);
});