# TUTORIAL-01: First Image and First Container (Node.js Edition)

## Learning Objectives

By the end of this lab, you will be able to:

* Understand what a Docker image really is
* Understand how containers are created from images
* Build your first custom Node.js image
* Run a Node.js application inside a container
* Inspect containers and images
* Understand the container lifecycle
* Apply production-grade Docker practices from day one

---

# Theory Deep Dive

## What is a Docker Image?

A Docker image is an immutable blueprint used to create containers.

Think of it as:

```text
Source Code
     ↓
Dockerfile
     ↓
Docker Image
     ↓
Docker Container
```

An image contains:

* Application code
* Runtime dependencies
* Operating system libraries
* Configuration
* Startup instructions

Example:

```text
node:22-alpine
├── Alpine Linux
├── Node.js Runtime
└── npm
```

The image itself is not running.

It is simply a packaged filesystem.

---

## What is a Docker Container?

A container is a running instance of an image.

Example:

```bash
docker run node:22-alpine
```

Docker performs the following steps:

1. Pulls image
2. Creates writable layer
3. Starts process
4. Creates container

Result:

```text
Image
   ↓
Container
   ↓
Running Process
```

A container is essentially:

```text
Process + Filesystem + Isolation
```

---

# Why This Matters in Production

Without containers:

```text
Dev Environment
Node 20

QA Environment
Node 18

Production
Node 22

Result:
"It works on my machine"
```

With Docker:

```text
Same Image
    ↓
Dev
QA
Production
```

Identical runtime everywhere.

This consistency is one of the biggest reasons Docker became the standard for modern software delivery.

---

# Core Docker Components

## Docker Engine

The daemon responsible for:

* Building images
* Running containers
* Managing networks
* Managing volumes

---

## Docker Client

The CLI used to interact with Docker Engine:

```bash
docker build
docker run
docker ps
```

---

## Docker Registry

Stores images.

Examples:

* Docker Hub
* GitHub Container Registry (GHCR)
* Amazon Elastic Container Registry (ECR)

---

# Real-World Scenario

Suppose you're deploying a Node.js API.

Without Docker:

```text
Install Node
Install npm
Install dependencies
Configure environment
Start application
```

With Docker:

```bash
docker run company/api:v1
```

Everything is already packaged.

---

# Lab Architecture

```text
Host Machine
│
├── Docker Engine
│
└── Container
     │
     ├── Node.js Runtime
     ├── Express Application
     └── Port 3000
```

---

# Hands-On Lab

## Step 1: Create Project

```bash
mkdir lab-01-first-container
cd lab-01-first-container
```

---

## Step 2: Create Node.js Application

### app.js

```javascript
const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.json({
    message: "Hello from Docker Container",
    hostname: process.env.HOSTNAME,
    timestamp: new Date().toISOString(),
  });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
```

---

## Step 3: Create package.json

> Note: The original package.json uses ES Modules (`"type": "module"`), so the application should use `import` syntax. Either remove `"type": "module"` or update `app.js` accordingly.

```json
{
  "name": "tut-01",
  "version": "1.0.0",
  "description": "Docker Lab 01",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "dev": "nodemon app.js"
  },
  "type": "commonjs",
  "dependencies": {
    "express": "^5.2.1"
  },
  "devDependencies": {
    "nodemon": "^3.1.14"
  }
}
```

---

## Step 4: Install Dependencies

```bash
npm install
```

Project structure:

```text
lab-01-first-container/
├── app.js
├── package.json
├── package-lock.json
└── node_modules/
```

Verify locally:

```bash
npm start
```

Visit:

```text
http://localhost:3000
```

---

# Creating Our First Dockerfile

Create a file named:

## Dockerfile

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

# Understanding Every Instruction

## FROM

```dockerfile
FROM node:22-alpine
```

Base image providing:

* Alpine Linux
* Node.js 22
* npm

---

## WORKDIR

```dockerfile
WORKDIR /app
```

Creates and switches into:

```text
/app
```

All subsequent commands execute from this directory.

---

## COPY Dependencies

```dockerfile
COPY package*.json ./
```

Copies:

```text
package.json
package-lock.json
```

into the image.

---

## RUN

```dockerfile
RUN npm install
```

Executes during image build and creates a dependency layer.

---

## COPY Application Code

```dockerfile
COPY . .
```

Copies the application source code.

---

## EXPOSE

```dockerfile
EXPOSE 3000
```

Documents that the container listens on port `3000`.

> EXPOSE does not publish the port.

---

## CMD

```dockerfile
CMD ["npm", "start"]
```

Defines the startup command executed when the container launches.

---

# Build Your First Image

```bash
docker build -t node-tut-01 .
```

Expected output:

```text
Successfully tagged node-tut-01
```

---

# View Images

```bash
docker images
```

Example:

```text
REPOSITORY      TAG
node-tut-01     latest
node            22-alpine
```

---

# Run Your First Container

```bash
docker run -d \
  --name first-node-container \
  -p 3000:3000 \
  node-tut-01
```

Explanation:

| Option   | Description    |
| -------- | -------------- |
| `-d`     | Detached mode  |
| `--name` | Container name |
| `-p`     | Port mapping   |

---

# Verify Running Container

```bash
docker ps
```

Example:

```text
CONTAINER ID   IMAGE         STATUS
8e2f5c11a7e2   node-tut-01   Up 5 seconds
```

---

# Test Application

Using curl:

```bash
curl localhost:3000
```

Expected response:

```json
{
  "message": "Hello from Docker Container",
  "hostname": "8e2f5c11a7e2",
  "timestamp": "2026-06-02T10:15:20.123Z"
}
```

---

# Inspect Container

```bash
docker inspect first-node-container
```

Useful information includes:

* IP Address
* Environment Variables
* Mounts
* Network Configuration
* Runtime Details

---

# View Logs

```bash
docker logs first-node-container
```

Example:

```text
Server running on port 3000
```

Follow logs in real-time:

```bash
docker logs -f first-node-container
```

---

# Execute Commands Inside Container

```bash
docker exec -it first-node-container sh
```

Inside the container:

```bash
pwd
ls
node -v
```

Exit:

```bash
exit
```

---

# Container Lifecycle

## Stop

```bash
docker stop first-node-container
```

## Start

```bash
docker start first-node-container
```

## Restart

```bash
docker restart first-node-container
```

## Remove

```bash
docker rm -f first-node-container
```

---

# Common Pitfalls

## Installing Dependencies After Copying Everything

### Bad

```dockerfile
COPY . .
RUN npm install
```

Every source code change invalidates the dependency cache.

### Good

```dockerfile
COPY package*.json ./

RUN npm install

COPY . .
```

Docker layer caching remains effective.

---

## Using Latest Tag

### Bad

```dockerfile
FROM node:latest
```

### Good

```dockerfile
FROM node:22-alpine
```

Production images should be predictable and reproducible.

---

# Production Optimization

Current:

```dockerfile
RUN npm install
```

Production:

```dockerfile
RUN npm ci --omit=dev
```

Benefits:

* Faster builds
* Deterministic installs
* Smaller image size

---

# Security Considerations

Our container currently runs as root.

Production containers should use non-root users.

Example:

```dockerfile
RUN addgroup -S nodegroup && \
    adduser -S nodeuser -G nodegroup

USER nodeuser
```

We'll implement this in later labs.

---

# Troubleshooting Guide

## Container Exits Immediately

Check logs:

```bash
docker logs first-node-container
```

Common causes:

* Missing dependencies
* Syntax errors
* Wrong startup command
* Application crash

---

## Port Not Reachable

Verify:

```bash
docker ps
```

Expected:

```text
0.0.0.0:3000->3000/tcp
```

---

## Image Build Failure

Force a clean rebuild:

```bash
docker build --no-cache -t node-tut-01 .
```

---

# SRE Perspective

An SRE views containers as isolated processes.

Monitor runtime metrics:

```bash
docker stats
```

Observe:

* CPU Usage
* Memory Usage
* Network I/O
* Block I/O

Example:

```text
CPU %
MEM USAGE
NET I/O
BLOCK I/O
```

These metrics later feed into:

* Prometheus
* Grafana
* OpenTelemetry

for production monitoring and observability.

---

# Interview Questions

## Junior

What is the difference between a Docker image and a Docker container?

---

## Intermediate

Why should we copy `package.json` before application source code?

---

## Senior

How does Docker layer caching improve build performance?

---

## SRE

What metrics would you monitor across thousands of Node.js containers?

---

# Key Takeaways

✅ Image = Blueprint

✅ Container = Running Instance

✅ Dockerfile defines image creation

✅ Containers package application and runtime together

✅ Layer ordering impacts build performance

✅ Containers provide environment consistency

✅ Docker is process isolation, not virtualization

---

# Repository Structure

```text
docker-tutorials/
└── LAB-01-Tut-01/
    ├── Tut01-First Image and First Container.md
    ├── Dockerfile
    ├── app.js
    └── package.json
```

---

# Lab Completion Checklist

```text
✓ Built custom Node.js image
✓ Ran container successfully
✓ Accessed application
✓ Viewed logs
✓ Inspected container
✓ Executed commands inside container
✓ Managed container lifecycle
✓ Understood image vs container
```
