const express = require('express');
const config = require('./config');
const { pool, connectWithRetry } = require('./db');
const { migrate } = require('./migrate');
const { startSubscriber } = require('./subscriber');
const { errorHandler } = require('./errorHandler');
const routes = require('./routes');

async function start() {
  await connectWithRetry();
  await migrate();
  await startSubscriber();

  const app = express();
  app.use(express.json());

  app.get('/health', async (req, res, next) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', service: 'notification-service' });
    } catch (error) {
      next(error);
    }
  });

  app.use('/notifications', routes);
  app.use(errorHandler);

  app.listen(config.port, () => {
    console.log(`notification-service listening on port ${config.port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start notification-service', error);
  process.exit(1);
});
