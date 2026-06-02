# Tutorial-02: Bind Mounts & Volumes Across Containers with NGINX + Node.js (Production-Grade)

---

## Learning Objectives

By the end of this lab, you will understand:

- Difference between Bind Mounts and Docker Volumes
- How multiple containers share data safely
- How NGINX uses mounted configuration and static assets
- How persistence works in Docker storage
- Real production patterns for config injection and shared storage
- How to debug volume-related issues in real environments

---

# Theory Deep Dive

## What is a Docker Volume?

A Docker volume is a persistent storage mechanism managed by Docker.

```

Container filesystem (ephemeral)
↓
Docker Volume (persistent)
↓
Host disk (/var/lib/docker/volumes/)

```

### Key properties:

- Survives container restart
- Survives container deletion
- Managed by Docker daemon

---

## What is a Bind Mount?

A bind mount maps a host directory directly into a container.

```

Host Machine Path
↓
/home/user/app/config
↓
Container Path
↓
/etc/nginx/conf.d

```

### Key properties:

- Direct access to host filesystem
- Useful for development
- Risky for production if misused

---

## Why This Matters in Production

### NGINX configuration externalization

```

No rebuild required for configuration changes

```

### Shared static assets between services

```

Frontend + Backend + CDN layer

```

### Persistent logs

```

Container stops or dies, logs remain available

```

---

## Bind Mount vs Volume

| Feature           | Bind Mount | Volume       |
|------------------|------------|-------------|
| Managed by Docker | No         | Yes         |
| Production safe   | Limited    | Yes         |
| Performance       | High       | High        |
| Portability       | Low        | High        |
| Use case          | Dev/config | Production storage |

---

# Real Production Architecture

We will build:

```
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



# Hands-On Lab

## Step 1: Create Project Structure

```bash
mkdir lab-02-volumes-nginx
cd lab-02-volumes-nginx
````

```
lab-02-volumes-nginx/
├── node-app/
├── nginx/
├── shared/
└── docker-compose.yml
```

---

## Step 2: Node.js Application

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

## Step 3: Shared Data

```bash
mkdir shared
echo "Hello from shared volume" > shared/shared.txt
```

---

## Step 4: NGINX Configuration (Bind Mount)

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

## Step 5: Docker Compose

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

## Step 6: Run the Stack

```bash
docker compose up -d --build
```

---

## Step 7: Verify Setup

### Check running containers

```bash
docker ps
```

---

### Test NGINX to Node proxy

```bash
curl http://localhost:8080
```

Expected response:

```json
{
  "service": "Node API",
  "timestamp": "..."
}
```

---

### Test shared volume

```bash
curl http://localhost:8080/file
```

Expected output:

```
Hello from shared volume
```

---

# Key Concepts

## Shared Volume Flow

```
node-app  → reads/writes → shared volume
nginx     → reads only   → shared volume
```

---

## Bind Mount Flow

```
Host nginx config → container runtime config
```

Changes reflect instantly without rebuilding images.

---

# Common Pitfalls

## Overusing bind mounts in production

```yaml
volumes:
  - .:/app
```

## Incorrect NGINX alias path

```nginx
alias /usr/share/nginx;
```

Correct:

```nginx
alias /usr/share/nginx/html;
```

## Missing read-only mode

```yaml
:ro
```

---

# Troubleshooting

## 502 Bad Gateway

```bash
docker logs nginx-proxy
```

Check:

* Node service is running
* Correct service name in proxy_pass

---

## Inspect volumes

```bash
docker volume inspect lab02_shared-data
```

---

# Security Considerations

* Use read-only mounts for configuration files
* Avoid mounting system directories
* Prefer named volumes in production
* Never expose Docker socket to containers

---

# SRE Perspective

Monitor system behavior using:

```bash
docker stats
```

Key metrics:

* Container CPU and memory usage
* Volume I/O performance
* NGINX upstream errors
* Node response latency

---

# Key Takeaways

* Volumes are Docker-managed persistent storage
* Bind mounts map host directories into containers
* NGINX uses bind mounts for configuration injection
* Shared volumes enable multi-container communication
* Production systems prefer volumes over bind mounts
* Docker Compose is the orchestration layer

```
