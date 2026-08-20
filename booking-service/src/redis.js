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

async function rateLimit(ip) {
  const key = `rate:${ip}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, config.rateLimitWindowSeconds);
  }
  return count <= config.rateLimitMax;
}

module.exports = { redis, connectRedis, rateLimit };
