const { createClient } = require('redis');
const config = require('./config');

const redis = createClient({ url: config.redisUrl });

async function connectRedis(retries = 20) {
  redis.on('error', (error) => {
    console.error('Redis error', error.message);
  });

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      if (!redis.isOpen) {
        await redis.connect();
      }
      await redis.ping();
      return;
    } catch (error) {
      console.log(`Waiting for Redis (${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Could not connect to Redis');
}

function eventCacheKey(id) {
  return `event:${id}`;
}

async function getCachedEvent(id) {
  const raw = await redis.get(eventCacheKey(id));
  return raw ? JSON.parse(raw) : null;
}

async function setCachedEvent(event) {
  await redis.setEx(eventCacheKey(event.id), config.cacheTtlSeconds, JSON.stringify(event));
}

async function invalidateEvent(id) {
  await redis.del(eventCacheKey(id));
}

module.exports = {
  redis,
  connectRedis,
  getCachedEvent,
  setCachedEvent,
  invalidateEvent,
};
