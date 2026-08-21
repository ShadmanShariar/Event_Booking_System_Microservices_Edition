const express = require('express');
const config = require('./config');
const { pool } = require('./db');
const { rateLimit } = require('./redis');
const { getJson, postJson } = require('./http');
const { publishBookingConfirmed } = require('./nats');

const router = express.Router();

async function rateLimitMiddleware(req, res, next) {
  try {
    const allowed = await rateLimit(req.ip || 'unknown');
    if (!allowed) {
      return res.status(429).json({ error: 'too many requests' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

router.post('/', rateLimitMiddleware, async (req, res, next) => {
  const { userId, eventId, seats } = req.body || {};
  const seatCount = Number(seats);

  try {
    if (!userId || !eventId || seats === undefined) {
      return res.status(400).json({ error: 'userId, eventId, and seats are required' });
    }
    if (!Number.isInteger(seatCount) || seatCount < 1) {
      return res.status(400).json({ error: 'seats must be a positive integer' });
    }

    const userResponse = await getJson(`${config.userServiceUrl}/users/${userId}`);
    if (userResponse.status === 404) {
      return res.status(404).json({ error: 'user not found' });
    }
    if (userResponse.status >= 400) {
      return res.status(502).json({ error: 'user service unavailable' });
    }

    const eventResponse = await getJson(`${config.eventServiceUrl}/events/${eventId}`);
    if (eventResponse.status === 404) {
      return res.status(404).json({ error: 'event not found' });
    }
    if (eventResponse.status >= 400) {
      return res.status(502).json({ error: 'event service unavailable' });
    }

    const reserveResponse = await postJson(
      `${config.eventServiceUrl}/events/${eventId}/reserve`,
      { seats: seatCount }
    );
    if (reserveResponse.status === 409) {
      return res.status(409).json({ error: 'not enough seats' });
    }
    if (reserveResponse.status === 404) {
      return res.status(404).json({ error: 'event not found' });
    }
    if (reserveResponse.status >= 400) {
      return res.status(502).json({ error: 'could not reserve seats' });
    }

    let booking;
    try {
      const result = await pool.query(
        `INSERT INTO bookings (user_id, event_id, seats, status)
         VALUES ($1, $2, $3, 'confirmed')
         RETURNING id, user_id, event_id, seats, status, created_at`,
        [userId, eventId, seatCount]
      );
      booking = result.rows[0];
    } catch (error) {
      await postJson(`${config.eventServiceUrl}/events/${eventId}/release`, { seats: seatCount });
      throw error;
    }

    await publishBookingConfirmed({
      bookingId: booking.id,
      userId: booking.user_id,
      userName: userResponse.body.name,
      userEmail: userResponse.body.email,
      eventId: booking.event_id,
      eventTitle: eventResponse.body.title,
      seats: booking.seats,
    });

    return res.status(201).json(booking);
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 5);
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM bookings');
    const total = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    const result = await pool.query(
      'SELECT id, user_id, event_id, seats, status, created_at FROM bookings ORDER BY id LIMIT $1 OFFSET $2',
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

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, user_id, event_id, seats, status, created_at FROM bookings WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'booking not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
