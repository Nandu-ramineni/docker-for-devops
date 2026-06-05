# Tutorial-02: Bind Mounts & Volumes Across Containers with NGINX + Node.js (Production-Grade)

---

## Learning Objectives

By the end of this lab, you will understand:

* Difference between **Bind Mounts vs Docker Volumes**
* How multiple containers can share data safely
* How NGINX uses mounted configuration and static assets
* How persistence works in Docker storage
* Real production patterns for config injection and shared storage
* How to debug volume-related issues in real environments

---

# Theory Deep Dive

## What is a Docker Volume?

A Docker volume is a **persistent storage mechanism managed by Docker**.

```text
Container filesystem (ephemeral)
        ↓
Docker Volume (persistent)
        ↓
Host disk (/var/lib/docker/volumes/)
```

Key property:

* Survives container restart
* Survives container deletion
* Managed by Docker daemon

---

## What is a Bind Mount?

A bind mount maps a **host directory directly into a container**.

```text
Host Machine Path
     ↓
/home/user/app/config
     ↓
Container Path
     ↓
/etc/nginx/conf.d
```

Key property:

* Direct access to host filesystem
* Great for development
* Risky for production if misused

---

## Why This Matters in Production

In real systems:

### NGINX config must be externalized

```text
No rebuild for config change
```

### Shared static assets between services

```text
Frontend + Backend + CDN layer
```

### Logs must persist

```text
Container dies → logs still exist
```

---

## Bind Mount vs Volume

| Feature           | Bind Mount | Volume       |
| ----------------- | ---------- | ------------ |
| Managed by Docker | ❌          | ✅            |
| Production safe   | ⚠️         | ✅            |
| Performance       | High       | High         |
| Portability       | Low        | High         |
| Use case          | Dev/config | Prod storage |

---

# Real Production Architecture

We will build:

```text
              ┌──────────────┐
              │   NGINX      │
              │ (Reverse Proxy)
              └──────┬───────┘
                     │
      ┌──────────────┴──────────────┐
      │                             │
┌──────────────┐         ┌──────────────┐
│ Node API     │         │ Static Files │
│ (Container)  │         │ (Shared Vol) │
└──────────────┘         └──────────────┘
```

---

# Hands-On Lab

## Step 1: Create Project Structure

```bash
mkdir lab-02-volumes-nginx
cd lab-02-volumes-nginx
```

```text
lab-02-volumes-nginx/
├── node-app/
├── nginx/
├── shared/
└── docker-compose.yml
```

---

## Step 2: Create Node.js App

### node-app/server.js

```javascript
const express = require("express");
const fs = require("fs");

const app = express();

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

app.listen(3000, () => {
  console.log("Node service running on port 3000");
});
```

---

### node-app/package.json

```json
{
  "name": "node-volume-app",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^5.1.0"
  }
}
```

---

### node-app/Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

---

# Step 3: Create Shared Data

```bash
mkdir shared
echo "Hello from shared volume" > shared/shared.txt
```

---

# Step 4: Create NGINX Config (Bind Mount)

### nginx/default.conf

```nginx
server {
    listen 80;

    location / {
        proxy_pass http://node-app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /static {
        alias /usr/share/nginx/html;
    }
}
```

---

# Step 5: Docker Compose (Core of This Lab)

### docker-compose.yml

```yaml
version: "3.9"

services:

  node-app:
    build: ./node-app
    container_name: node-service
    volumes:
      - shared-data:/data
    networks:
      - app-network

  nginx:
    image: nginx:alpine
    container_name: nginx-proxy
    ports:
      - "8080:80"
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - shared-data:/usr/share/nginx/html:ro
    depends_on:
      - node-app
    networks:
      - app-network

networks:
  app-network:
```

---

# Step 6: Run the Stack

```bash
docker compose up -d --build
```

---

# Step 7: Verify Services

## Check containers

```bash
docker ps
```

---

## Test NGINX → Node Proxy

```bash
curl http://localhost:8080
```

Expected:

```json
{
  "service": "Node API",
  "timestamp": "..."
}
```

---

## Test Shared Volume via Node

```bash
curl http://localhost:8080/file
```

Expected:

```text
Hello from shared volume
```

---

# Understanding What Happened

## Shared Volume Behavior

```text
node-app  ─── writes/reads ─── shared volume
nginx     ─── reads only  ─── shared volume
```

Same data, multiple consumers.

---

## Bind Mount Behavior

```text
./nginx/default.conf
        ↓
Container runtime config
```

Any change on host instantly reflects in container.

---

# Why This Pattern is Used in Production

## 1. Config Externalization

NGINX config is NOT baked into image.

```text
No rebuild required
```

---

## 2. Shared Asset Layer

Used in:

* CDN edge caching
* Microservices file exchange
* Static asset delivery

---

## 3. Decoupled Deployment

```text
Update config → no redeploy
```

---

# Common Pitfalls

## 1. Overusing Bind Mounts in Production

Bad:

```yaml
volumes:
  - .:/app
```

Risk:

* Breaks immutability
* Security exposure

---

## 2. Wrong NGINX Alias Path

Incorrect:

```nginx
alias /usr/share/nginx;
```

Correct:

```nginx
alias /usr/share/nginx/html;
```

---

## 3. Forgetting Read-Only Mode

```yaml
:ro
```

Without it:

* Containers can modify host files
* Security risk

---

# Troubleshooting Guide

## Issue: NGINX 502 Bad Gateway

Check:

```bash
docker logs nginx-proxy
```

Fix:

* Node container not running
* Wrong service name in proxy_pass

---

## Issue: Shared file not visible

Check volume:

```bash
docker volume ls
docker volume inspect lab02_shared-data
```

---

## Issue: Permission denied

Fix:

```bash
chmod -R 755 shared/
```

---

# Performance Considerations

## Volumes vs Bind Mounts

* Volumes → faster in production
* Bind mounts → slower on Mac/Windows

---

## I/O optimization

Avoid:

```text
High-frequency writes to shared volumes
```

Use:

* Buffers
* Log batching
* Async writes

---

# Security Considerations

* Always use `:ro` for NGINX configs
* Avoid mounting `/` or system directories
* Use named volumes in production
* Never expose host Docker socket

---

# SRE Perspective

What SREs monitor:

```bash
docker stats
```

Metrics:

* Network latency between containers
* Disk I/O on volumes
* NGINX upstream failures
* Node response time

---

# Interview Questions

### Junior

What is the difference between bind mount and volume?

---

### Intermediate

Why is shared volume useful in microservices?

---

### Senior

How does Docker storage driver affect volume performance?

---

### SRE

How would you debug intermittent file inconsistency in shared volumes?

---

# Key Takeaways

* Volumes = Docker-managed persistent storage
* Bind mounts = direct host filesystem mapping
* NGINX uses bind mounts for config injection
* Multiple containers can safely share volumes
* Production favors volumes, not bind mounts
* Docker Compose is the orchestration glue

---

