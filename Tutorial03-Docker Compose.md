# Tutorial-03: Docker Compose — Node.js + Redis + MongoDB Atlas

## Learning Objectives

By the end of this lab, you will understand:

- How Docker Compose manages a multi-container application as a single unit
- The difference between containerized services and external cloud services in the same stack
- How to implement the cache-aside pattern with Redis sitting in front of MongoDB
- How to manage environment variables and secrets without hardcoding credentials anywhere
- How healthchecks work and why `depends_on` alone is not enough
- How to handle graceful shutdown properly — the gap we flagged in Tutorial 01

---

## Where This Fits in the Series

Tutorial 01 gave you one container running a Node.js app. Tutorial 02 added NGINX as a reverse proxy and showed how Docker's internal DNS wires services together. This lab introduces three tiers of state in one Compose stack: a cloud database (MongoDB Atlas), an in-memory cache (Redis), and a stateless API layer (Node.js).

Two things make this tutorial different from the previous ones. First, MongoDB Atlas is an external cloud service — there is no MongoDB container. Your Node app connects to it over TLS from inside Docker, the same way it would from any server. This hybrid pattern, where some services run in containers and others live outside Docker entirely, is the norm in real production environments. Second, secrets management actually matters now. Your Atlas connection string contains a password. How you handle that in Compose sets the pattern for everything that follows.

---

## The Architecture

```text
┌──────────────────────────────────────────────────────────┐
│  Docker Compose (on your machine)                        │
│                                                          │
│  ┌─────────────┐          ┌──────────────────────────┐   │
│  │  node-api   │◀────────▶│  redis:7-alpine          │   │
│  │  :3000      │  cache   │  :6379 (internal only)   │   │
│  └──────┬──────┘          └──────────────────────────┘   │
│         │                                                 │
└─────────┼───────────────────────────────────────────────-┘
          │ MONGO_URI over TLS
          ▼
┌─────────────────────────────┐
│  MongoDB Atlas (Cloud)      │
│  External — no container    │
└─────────────────────────────┘
```

Redis is on the same Docker network as Node — a cache hit is a local network round trip, measured in microseconds. MongoDB Atlas is across the internet. The whole point of the cache layer is to keep the majority of read traffic from ever leaving the Docker network.

---

## Why Redis Sits Between Node and Atlas

MongoDB Atlas is fast for a cloud database, but every query involves a TLS handshake, a network hop, and a collection scan or index lookup. For endpoints that serve the same data repeatedly — user profiles, product listings, configuration — that round trip adds latency on every single request.

The cache-aside pattern fixes this. On a read request, the application checks Redis first. If the key exists, it returns the cached result immediately. If not, it fetches from Atlas, stores the result in Redis with a TTL, and returns it. Every subsequent identical request hits the cache instead.

```text
GET /users
    │
    ▼
Check Redis — key "users:all" exists?
    │
 ┌──┴──┐
HIT   MISS
 │      │
 │      ▼
 │   Query MongoDB Atlas
 │      │
 │      ▼
 │   Store in Redis (TTL: 60s)
 │      │
 └──────┤
        ▼
   Return response
```

The TTL is not a nice-to-have. If a cached key never expires, a user you deleted from Atlas will keep appearing in the list until you restart Redis. Get the TTL wrong in the other direction — too short — and you eliminate the latency benefit. Picking the right TTL is a judgment call based on how often your data changes and how much staleness your users can tolerate.

Cache invalidation on writes is the other half of this. When you create or delete a user, you must also delete the relevant cache keys. The TTL is a safety net, not the primary invalidation mechanism.

---

## Hands-On Lab

### Step 1: Project Structure

```bash
mkdir Tutorial03-Docker Compose
cd Tutorial03-Docker Compose
```

```text
Tutorial03-Docker Compose/
├── server/
│   |
│   |── routes/
│   │       └── userRoutes.js
│   |── models/
│   │       └── user.js
│   |── cache/
│   │       └── redis.js
│   |─ db/
│   │  └── config.js
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
|   |___.env
├── docker-compose.yml
└── .gitignore
```

---

### Step 2: Environment Variables — Start Here, Not Last

Set this up before writing a single line of application code. Retrofitting secrets management after the fact is how credentials end up accidentally committed to Git.

**.env.example** — commit this file

```env
# MongoDB Atlas connection string
MONGO_URI=mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/<dbname>?retryWrites=true&w=majority

# Redis — uses the Docker service name, not localhost
REDIS_URL=redis://redis:6379

# Application
PORT=3000
NODE_ENV=development
CACHE_TTL=60
```

**.env** — never commit this file

```env
MONGO_URI=mongodb+srv://youruser:yourpassword@cluster0.xxxxx.mongodb.net/lab03?retryWrites=true&w=majority
REDIS_URL=redis://redis:6379
PORT=3000
NODE_ENV=development
CACHE_TTL=60
```

**.gitignore**

```gitignore
.env
node_modules/
```

Add `.env` to `.gitignore` before your first commit. Not after the first commit. Before. Once credentials appear in Git history, deleting the file from the repository does not remove them from the history — you have to rotate them.

`REDIS_URL` uses the service name `redis`, not `localhost`. Inside Docker, each container has its own network namespace. `localhost` inside the Node container means the Node container, not Redis. Docker's internal DNS resolves `redis` to the Redis container's IP automatically.

> **MongoDB Atlas Setup:** Create a free M0 cluster at atlas.mongodb.com. Add a database user with readWrite access. Under Network Access, add `0.0.0.0/0` to allow connections from any IP during development — tighten this to specific IP ranges before any real deployment. Copy the connection string, replace `<password>` with your database user password, replace `<dbname>` with `lab03`, and paste it into your `.env` file.

---

### Step 3: MongoDB Connection Module

**server/db/config.js**

```javascript
import mongoose from 'mongoose';
import dotenv from 'dotenv';

export const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

export const disconnectDB = async () => {
    try {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    } catch (error) {
        console.error('MongoDB disconnection error:', error);
    }   
    process.exit(0);
};
```


### Step 4: Redis Client

**server/cache/redis.js**

```javascript
import redis from 'redis';

const client = redis.createClient({
    url: process.env.REDIS_URL
});

client.connect()
    .then(() => {
        console.log('Redis client connected');
    })
    .catch((err) => {
        console.error('Redis connection error', err);
    });

client.on('error', (err) => {
    console.error('Redis error', err);
});

export const setCache = async (key, value, ttl) => {
    try {
        await client.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
        console.error('Error setting cache:', err);
    }
};

export const getCache = async (key) => {
    try {
        const data = await client.get(key);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        console.error('Error getting cache:', err);
        return null;
    }
};

export const deleteCache = async (key) => {
    try {
        await client.del(key);
    } catch (err) {
        console.error('Error deleting cache:', err);
    }
};

export const disconnectCache = async () => {
    try {
        await client.quit();
        console.log('Redis client disconnected');
    } catch (err) {
        console.error('Error disconnecting Redis:', err);
    }
};
```
---

### Step 5: User Model

**server/models/user.js**

```javascript
import mongoose from "mongoose";


const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

export default User;
```

---

### Step 6: Users Route with Cache-Aside

**server/userRoutes.js**

```javascript
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
```


The write routes delete cache keys immediately after writing to Atlas. If you skip this step, clients will see stale data on list requests until the TTL expires. For a 60-second TTL that is annoying. For a production system with hour-long TTLs, it is a correctness bug.

---

### Step 7: Main Application with Graceful Shutdown

**server/app.js**

```javascript
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
```

Tutorial 01 flagged graceful shutdown as a gap and promised to close it. Here it is. When Docker runs `docker stop`, it sends `SIGTERM` to the process. This handler closes the HTTP server — which stops accepting new connections but lets in-flight requests finish — then closes the Redis and MongoDB connections before exiting. Without this, Docker waits 10 seconds and force-kills the process. Any in-flight requests get dropped mid-response.

---

### Step 8: Package.json and Dockerfile

**server/package.json**

```json
{
  "name": "server",
  "version": "1.0.0",
  "description": "",
  "main": "server.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "dev": "nodemon server.js",
    "start": "node server.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "module",
  "dependencies": {
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "mongoose": "^9.6.3",
    "nodemon": "^3.1.14",
    "redis": "^6.0.0"
  }
}

```

**server/Dockerfile**

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

`npm ci --omit=dev` instead of `npm install` — this was the production recommendation from Tutorial 01, applied here from the start. Deterministic installs, no devDependencies in the image.

---

### Step 9: Docker Compose

**docker-compose.yml**

```yaml

services:
  
  node-api:
    build: ./server
    container_name: node-api
    ports:
      - "3000:3000"
    env_file:
      - ./server/.env
    depends_on:
      redis:
        condition: service_healthy
    networks:
      - app-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "redis-cli","ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

volumes:
  redis-data:

networks:
  app-network:
```

**`env_file: - .env`** loads your `.env` file into the container's environment. This keeps the Compose file clean — no credentials, no environment-specific values. The Compose file can be committed to Git without modification.

**`depends_on` with `condition: service_healthy`** is the upgrade from Tutorial 02's basic `depends_on`. Last time it only controlled startup order. Here it waits until Redis reports healthy before starting the Node container. Without this, Node can start before Redis is ready, the Redis client connection fails, and the container exits on the first request.

**`healthcheck`** runs `redis-cli ping` inside the Redis container every 10 seconds. `start_period: 10s` gives Redis time to initialize before failures start counting toward the retry limit — without it, the first few health checks fail before Redis is ready and the container gets marked unhealthy prematurely.

**Redis `ports: 6379:6379`** is exposed to the host here for debugging. In production, remove the `ports` entry for Redis entirely. It should only be reachable from inside `app-network`. Exposed Redis with no password on a cloud VM with a public IP is a serious security problem.

**`restart: unless-stopped`** restarts a container automatically if it crashes — unless you explicitly stopped it. This is a basic safety net for single-host deployments. In Kubernetes or ECS, the orchestrator handles restarts, so this field does not apply.

---

### Step 10: Start the Stack

```bash
docker compose up -d --build
```

Watch startup to confirm the health check gates the Node container:

```bash
docker compose ps
```

Redis should show `(healthy)` before Node transitions from `starting` to `running`. If you see Node in `(unhealthy)` or exited, check the logs.

```bash
docker compose logs -f
```

Expected startup sequence:

```text
redis     | Ready to accept connections tcp
node-api  | Connected to Redis
node-api  | Connected to MongoDB Atlas
node-api  | API running on port 3000
```

---

### Step 11: Test the API

**Create a user:**

```bash
curl -X POST http://localhost:3000/v1/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Nandu", "email": "nandu@example.com"}'
```

**Fetch users — first call hits MongoDB Atlas:**

```bash
curl http://localhost:3000/v1/users
# {"source":"db","data":[...]}
```

**Fetch users again — this call hits Redis:**

```bash
curl http://localhost:3000/v1/users
# {"source":"cache","data":[...]}
```

**Health check:**

```bash
curl http://localhost:3000/health
# {"status":"ok","redis":"ready","timestamp":"..."}
```

**Verify what is in Redis directly:**

```bash
docker exec -it redis redis-cli
127.0.0.1:6379> KEYS *
1) "users:all"
127.0.0.1:6379> TTL users:all
(integer) 43
127.0.0.1:6379> GET users:all
"[{\"_id\":\"...\",\"name\":\"Nandu\"...}]"
```

Watching the TTL count down confirms the cache will expire on its own. Now create another user and verify `users:all` disappears from Redis immediately — that is the cache invalidation working.

**Verify graceful shutdown:**

```bash
docker compose stop node-api
```

Watch the logs. You should see:

```text
Received SIGTERM. Shutting down gracefully...
All connections closed. Exiting.
```

If you see that, the SIGTERM handler is working correctly.

---

## Common Mistakes

**Storing `.env` in Git.** Credentials pushed to a public repository are scraped by automated bots within minutes. This is not hypothetical — it is routine. Add `.env` to `.gitignore` before the first commit. If you do push credentials by mistake, rotate them immediately. Removing the file from the repository does not remove it from the history.

**Skipping cache invalidation on writes.** Creating a user but not deleting `users:all` from Redis means the list endpoint keeps returning stale data until the TTL expires. In this lab with a 60-second TTL that is mildly annoying. In a production system with longer TTLs, it is a real correctness problem that erodes user trust.

**Using `localhost` for Redis inside Docker.** Each container has its own network namespace. `localhost` inside the Node container refers to the Node container. To reach Redis, use the service name: `redis://redis:6379`. This is the same DNS-based service discovery from Tutorial 02.

**Trusting `depends_on` to mean "ready."** `depends_on: condition: service_started` (the default) only orders startup. `condition: service_healthy` waits for the healthcheck to pass. Without a healthcheck on Redis, Compose has no way to know when Redis is actually accepting connections. The ioredis retry strategy covers the remaining gap, but the healthcheck is the right first line of defense.

**Exposing Redis on `0.0.0.0` without a password.** Fine for local development. Dangerous on any internet-facing host. Before deploying anywhere, add `requirepass`:

```yaml
redis:
  image: redis:7-alpine
  command: redis-server --requirepass ${REDIS_PASSWORD}
```

And add `REDIS_PASSWORD` to your `.env` file.

---

## Troubleshooting

**Node API exits at startup:**

```bash
docker compose logs node-api
```

`MongooseServerSelectionError` means Atlas is unreachable — the connection string is wrong, the password changed, or the IP is not whitelisted. `Redis connection failed` means either the healthcheck condition was not met or `REDIS_URL` is malformed. Check both logs together since Node starts only after Redis is healthy.

**Redis healthcheck stuck in `starting`:**

```bash
docker inspect redis --format '{{json .State.Health}}'
```

If `Status` is `unhealthy`, check the Redis logs:

```bash
docker compose logs redis
```

Verify the ping command works manually:

```bash
docker exec -it redis redis-cli ping
# PONG
```

If that returns `PONG`, the container is fine and the healthcheck configuration may have a formatting issue in your Compose file.

**Atlas connects locally but not from Docker:**

When your container connects to Atlas, the outbound request comes from your host machine's public IP — the same one you used when developing locally. This normally works. If Atlas is configured with specific IP allowlist entries rather than `0.0.0.0/0`, check that your current public IP is listed. Your ISP-assigned IP can change.

**Cache never being hit:**

```bash
docker exec -it redis redis-cli KEYS "*"
```

If that returns empty after a GET request, `cache.set` is failing silently. Add error handling around the Redis set call and check the Node logs. Also confirm the `CACHE_TTL` environment variable is set — without it, the default is 60, but a misconfigured `.env` could result in `NaN` being passed to `EX`.

---

## Production Notes

**Redis persistence.** By default, Redis keeps everything in memory and loses it on restart. The `redis-data` named volume stores the data directory, but without a persistence configuration, Redis does not write anything there. For caches that take time to warm up, enable RDB snapshots:

```yaml
redis:
  command: redis-server --save 60 1 --appendonly yes
```

This creates a checkpoint every 60 seconds if at least 1 key changed, and logs every write to an append-only file. The named volume already exists to hold this data.

**Mongoose connection pool.** Mongoose opens up to 5 connections per instance by default. With multiple Node containers (which you will have in any serious deployment), that multiplies. Set it explicitly:

```javascript
await mongoose.connect(uri, {
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10,
});
```

**Move secrets out of `.env` files before production.** `.env` files work for local development. For production deployments, use Docker secrets, AWS Secrets Manager, HashiCorp Vault, or your orchestrator's native secrets mechanism (Kubernetes secrets, ECS task definition secrets). The rule is straightforward: credentials should never exist as plaintext files on a production host.

**Memory limits on Redis.** Redis will consume as much memory as you give it. Without an upper bound, a runaway key generation pattern can take down the host. Set a limit:

```yaml
redis:
  deploy:
    resources:
      limits:
        memory: 256m
```

And set a `maxmemory-policy` in Redis so it evicts keys when the limit is hit rather than refusing writes:

```yaml
command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

`allkeys-lru` evicts the least recently used keys first, which is the right behavior for a cache layer.

---

## Monitoring

```bash
docker compose stats
```

Watch Redis memory under sustained load. If it grows without bound, keys are not expiring. Check the keyspace:

```bash
docker exec -it redis redis-cli INFO keyspace
```

And verify keys have TTLs set:

```bash
docker exec -it redis redis-cli TTL users:all
# Should return a positive integer, not -1 (no expiry)
```

`-1` means the key has no TTL — it will live in Redis until you delete it or restart the container. If that is unexpected, trace back to the `cache.set` call and confirm the TTL argument is being passed correctly.

---

## Key Takeaways

`depends_on` with `condition: service_healthy` is how you express a real dependency between services. Without a healthcheck on the dependency, Compose has no information about readiness — it only knows the container started.

Cache invalidation on every write is not optional. The TTL is the last line of defense against stale data, not the primary mechanism. Every write operation must explicitly delete the cache keys it affects.

`env_file` keeps credentials out of the Compose file. The Compose file should be safe to commit. The `.env` file never is.

Graceful shutdown with `SIGTERM` handling lets in-flight requests complete before the container exits. Without it, Docker kills the process hard after 10 seconds and drops everything in flight.

Redis should not be exposed to the host in production. It should only be reachable from containers on the same Docker network.

---

