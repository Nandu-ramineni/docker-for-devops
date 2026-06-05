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