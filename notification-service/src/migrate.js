const { pool } = require('./db');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      booking_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

module.exports = { migrate };
