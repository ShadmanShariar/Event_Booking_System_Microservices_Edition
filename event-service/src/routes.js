const express = require('express');
const { pool } = require('./db');
const { getCachedEvent, setCachedEvent, invalidateEvent } = require('./cache');

const router = express.Router();

function mapEvent(row) {
  return {
    id: row.id,
    title: row.title,
    seats: row.seats,
    date: row.date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

router.post('/', async (req, res, next) => {
  try {
    const { title, seats, date } = req.body || {};
    if (!title || seats === undefined || !date) {
      return res.status(400).json({ error: 'title, seats, and date are required' });
    }
    const seatCount = Number(seats);
    if (!Number.isInteger(seatCount) || seatCount < 0) {
      return res.status(400).json({ error: 'seats must be a non-negative integer' });
    }
    const eventDate = new Date(date);
    if (Number.isNaN(eventDate.getTime())) {
      return res.status(400).json({ error: 'date is invalid' });
    }

    const result = await pool.query(
      `INSERT INTO events (title, seats, date)
       VALUES ($1, $2, $3)
       RETURNING id, title, seats, date, created_at, updated_at`,
      [title.trim(), seatCount, eventDate.toISOString()]
    );
    return res.status(201).json(mapEvent(result.rows[0]));
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, parseInt(req.query.limit, 10) || 5);
    const offset = (page - 1) * limit;

    const countResult = await pool.query('SELECT COUNT(*) FROM events');
    const total = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    const result = await pool.query(
      'SELECT id, title, seats, date, created_at, updated_at FROM events ORDER BY date LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    return res.json({
      data: result.rows.map(mapEvent),
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
    const cached = await getCachedEvent(req.params.id);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    const result = await pool.query(
      'SELECT id, title, seats, date, created_at, updated_at FROM events WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'event not found' });
    }

    const event = mapEvent(result.rows[0]);
    await setCachedEvent(event);
    return res.json({ ...event, cached: false });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { title, seats, date } = req.body || {};
    if (!title || seats === undefined || !date) {
      return res.status(400).json({ error: 'title, seats, and date are required' });
    }
    const seatCount = Number(seats);
    if (!Number.isInteger(seatCount) || seatCount < 0) {
      return res.status(400).json({ error: 'seats must be a non-negative integer' });
    }
    const eventDate = new Date(date);
    if (Number.isNaN(eventDate.getTime())) {
      return res.status(400).json({ error: 'date is invalid' });
    }

    const result = await pool.query(
      `UPDATE events
       SET title = $1, seats = $2, date = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, title, seats, date, created_at, updated_at`,
      [title.trim(), seatCount, eventDate.toISOString(), req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'event not found' });
    }

    const event = mapEvent(result.rows[0]);
    await invalidateEvent(event.id);
    return res.json(event);
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const result = await pool.query('DELETE FROM events WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'event not found' });
    }
    await invalidateEvent(req.params.id);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

// Atomic seat decrement. PostgreSQL row lock on UPDATE prevents overselling.
router.post('/:id/reserve', async (req, res, next) => {
  try {
    const seats = Number(req.body?.seats);
    if (!Number.isInteger(seats) || seats < 1) {
      return res.status(400).json({ error: 'seats must be a positive integer' });
    }

    const result = await pool.query(
      `UPDATE events
       SET seats = seats - $1, updated_at = NOW()
       WHERE id = $2 AND seats >= $1
       RETURNING id, title, seats, date, created_at, updated_at`,
      [seats, req.params.id]
    );

    if (!result.rows[0]) {
      const exists = await pool.query('SELECT id FROM events WHERE id = $1', [req.params.id]);
      if (!exists.rows[0]) {
        return res.status(404).json({ error: 'event not found' });
      }
      return res.status(409).json({ error: 'not enough seats' });
    }

    const event = mapEvent(result.rows[0]);
    await invalidateEvent(event.id);
    return res.json(event);
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/release', async (req, res, next) => {
  try {
    const seats = Number(req.body?.seats);
    if (!Number.isInteger(seats) || seats < 1) {
      return res.status(400).json({ error: 'seats must be a positive integer' });
    }

    const result = await pool.query(
      `UPDATE events
       SET seats = seats + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, title, seats, date, created_at, updated_at`,
      [seats, req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'event not found' });
    }

    const event = mapEvent(result.rows[0]);
    await invalidateEvent(event.id);
    return res.json(event);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
