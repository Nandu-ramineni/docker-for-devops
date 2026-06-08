import express from 'express';
import os, { hostname } from 'os';
import http from 'http'
import { error } from 'console';

const app = express();

app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        hostname: os.hostname()
    });
});

app.get('/network',(_req,res) => {
    const interfaces = os.networkInterfaces();

    const addresses = Object.entries(interfaces).flatMap(([name,addrs]) => 
        addrs.filter(a => a.family === 'IPv4' && !a.internal)
        .map(a => ({interfaces: name,ip:a.address}))
    );

    res.json({hostname:os.hostname(),addresses})
});

app.get('/probe',(req,res) => {
    const {host,port = '80'} = req.query;

    if(!host){
        return res.status(400).json({error:'Host query param is required'})
    }

    const outbound = http.get({
        host,port:Number(port),path:'/', timeout:300
    },
    (incoming) => {
        res.json({host,port:Number(port), reachable:true, httpStatues: incoming.statusCode});
    }
    );

    outbound.on('error',(err) => {
        res.json({ host, port: Number(port), reachable: false, reason: err.message });
    })

    outbound.on('timeout', () => {
        outbound.destroy();
        res.json({ host, port: Number(port), reachable: false, reason: 'connection timed out' });
    });
})

app.listen(3000, () => console.log('API listening on :3000'));