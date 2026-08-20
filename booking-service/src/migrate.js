const { pool } = require('./db');

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      seats INTEGER NOT NULL CHECK (seats > 0),
      status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

module.exports = { migrate };
