module.exports = {
  port: Number(process.env.PORT) || 3003,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  natsUrl: process.env.NATS_URL,
  userServiceUrl: process.env.USER_SERVICE_URL,
  eventServiceUrl: process.env.EVENT_SERVICE_URL,
  bookingTopic: 'booking.confirmed',
  rateLimitMax: 20,
  rateLimitWindowSeconds: 60,
};
