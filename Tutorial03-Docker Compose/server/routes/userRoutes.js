import express from "express";
import User from "../models/user.js";
import { deleteCache, getCache, setCache } from "../cache/redis.js";


const router = express.Router();

const CACHE_TTL = process.env.CACHE_TTL || 60;


router.get("/users", async (req, res) => {
    try {
        const cacheKey = "users:all";

        const cached = await getCache(cacheKey);
        if (cached) {
            return res.json({ source: "cache", data: cached });
        }

        const users = await User.find().sort({ createdAt: -1 }).lean();
        await setCache(cacheKey, users, CACHE_TTL);

        res.json({ source: "db", data: users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


router.get("/users/:id", async (req, res) => {
    try {
        const cacheKey = `users:${req.params.id}`;

        const cached = await getCache(cacheKey);
        if (cached) {
            return res.json({ source: "cache", data: cached });
        }

        const user = await User.findById(req.params.id).lean();
        if (!user) return res.status(404).json({ error: "User not found" });

        await setCache(cacheKey, user, CACHE_TTL);
        res.json({ source: "db", data: user });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


router.post("/users", async (req, res) => {
    try {
        const user = await User.create(req.body);
        await deleteCache("users:all");

        res.status(201).json(user);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});


router.delete("/users/:id", async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        await deleteCache(`users:${req.params.id}`);
        await deleteCache("users:all");

        res.json({ message: "Deleted", id: req.params.id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;