const { connect } = require('nats');
const config = require('./config');

let natsConnection;

async function connectNats(retries = 20) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      natsConnection = await connect({ servers: config.natsUrl });
      return natsConnection;
    } catch (error) {
      console.log(`Waiting for NATS (${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('Could not connect to NATS');
}

async function publishBookingConfirmed(payload) {
  natsConnection.publish(config.bookingTopic, Buffer.from(JSON.stringify(payload)));
}

module.exports = { connectNats, publishBookingConfirmed };
