import express from 'express';
import fs from 'fs';

const app = express();

const PORT = 3000;

app.get("/", (req, res) => {
    res.json({
        service: "Node API",
        timestamp: new Date().toISOString()
    });
});

app.get("/file", (req, res) => {
    const data = fs.readFileSync("/data/shared.txt", "utf-8");
    res.send(data);
});
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});