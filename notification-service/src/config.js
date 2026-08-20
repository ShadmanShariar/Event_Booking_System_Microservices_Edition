module.exports = {
  port: Number(process.env.PORT) || 3004,
  databaseUrl: process.env.DATABASE_URL,
  natsUrl: process.env.NATS_URL,
  bookingTopic: 'booking.confirmed',
};
