module.exports = {
  port: Number(process.env.PORT) || 3002,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  cacheTtlSeconds: 60,
};
