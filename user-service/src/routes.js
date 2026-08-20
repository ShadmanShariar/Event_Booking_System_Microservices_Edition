const express = require('express');
const { pool } = require('./db');

const router = express.Router();
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/', async (req, res, next) => {
  try {
    const { name, email } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ error: 'name and email are required' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'email is invalid' });
    }

    const result = await pool.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name, email, created_at',
      [name.trim(), email.trim().toLowerCase()]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'email already exists' });
    }
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users ORDER BY id'
    );
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
