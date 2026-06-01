import express from 'express';

const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
    res.json({
        message: "Hello from Docker Container",
        hostname: process.env.HOSTNAME,
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});