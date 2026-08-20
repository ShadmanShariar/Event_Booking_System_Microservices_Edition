const express = require('express');
const { pool } = require('./db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, booking_id, user_id, event_id, message, created_at FROM notifications ORDER BY id DESC'
    );
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
