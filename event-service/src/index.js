const express = require('express');
const config = require('./config');
const { pool, connectWithRetry } = require('./db');
const { connectRedis } = require('./cache');
const { migrate } = require('./migrate');
const { errorHandler } = require('./errorHandler');
const routes = require('./routes');

async function start() {
  await connectWithRetry();
  await connectRedis();
  await migrate();

  const app = express();
  app.use(express.json());

  app.get('/health', async (req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'event-service' });
    } catch (error) {
      next(error);
    }
  });

  app.use('/events', routes);
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`event-service listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start event-service', error);
  process.exit(1);
});
