const express = require('express');
const { pool } = require('./db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 5);
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM notifications');
    const total = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    const result = await pool.query(
      'SELECT id, booking_id, user_id, event_id, message, created_at FROM notifications ORDER BY id DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    return res.json({
      data: result.rows,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
