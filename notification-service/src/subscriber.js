const { connect, StringCodec } = require('nats');
const config = require('./config');
const { pool } = require('./db');

const codec = StringCodec();

async function connectNats(retries = 20) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await connect({ servers: config.natsUrl });
    } catch (error) {
      console.log(`Waiting for NATS (${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Could not connect to NATS');
}

async function startSubscriber() {
  const natsConnection = await connectNats();
  const subscription = natsConnection.subscribe(config.bookingTopic);
  console.log(`Listening for ${config.bookingTopic}`);

  (async () => {
    for await (const message of subscription) {
      try {
        const data = JSON.parse(codec.decode(message.data));
        const text = `Booking confirmed for ${data.userName} (${data.userEmail}): ${data.seats} seat(s) for "${data.eventTitle}". Booking ID ${data.bookingId}.`;
        await pool.query(
          `INSERT INTO notifications (booking_id, user_id, event_id, message)
           VALUES ($1, $2, $3, $4)`,
          [data.bookingId, data.userId, data.eventId, text]
        );
        console.log(text);
      } catch (error) {
        console.error('Failed to process booking event', error);
      }
    }
  })();

  return natsConnection;
}

module.exports = { startSubscriber };
