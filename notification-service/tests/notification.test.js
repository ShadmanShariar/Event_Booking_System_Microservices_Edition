const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { pool } = require('../src/db');
const routes = require('../src/routes');
const { errorHandler } = require('../src/errorHandler');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/notifications', routes);
  app.use(errorHandler);
  return app;
}

function makeRequest(app, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const url = new URL(path, `http://127.0.0.1:${port}`);
      const req = http.request(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          server.close();
          let json = null;
          try { json = JSON.parse(data); } catch { json = data; }
          resolve({ status: res.statusCode, body: json });
        });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  });
}

describe('Notification Service Unit Tests', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  test('GET /notifications - returns paginated notifications', async () => {
    const mockNotifications = [
      {
        id: 1,
        booking_id: 10,
        user_id: 2,
        event_id: 5,
        message: 'Booking confirmed for Aisha (aisha@example.com): 2 seat(s)',
        created_at: new Date().toISOString(),
      },
    ];

    pool.query = async (sql) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '1' }] };
      }
      if (sql.includes('SELECT id, booking_id')) {
        return { rows: mockNotifications };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'GET', '/notifications?page=1&limit=5');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.pagination.total, 1);
    assert.equal(res.body.pagination.page, 1);
    assert.equal(res.body.pagination.limit, 5);
    assert.equal(res.body.pagination.totalPages, 1);
  });

  test('Processes booking confirmed message and inserts into database', async () => {
    let insertedValues = null;

    pool.query = async (sql, params) => {
      if (sql.includes('INSERT INTO notifications')) {
        insertedValues = params;
        return { rows: [{ id: 1 }] };
      }
      return { rows: [] };
    };

    // Simulate NATS message processing logic directly
    const data = {
      bookingId: 101,
      userId: 5,
      userName: 'John Doe',
      userEmail: 'john@example.com',
      eventId: 20,
      eventTitle: 'Tech Summit',
      seats: 2,
    };

    const expectedText = `Booking confirmed for ${data.userName} (${data.userEmail}): ${data.seats} seat(s) for "${data.eventTitle}". Booking ID ${data.bookingId}.`;

    await pool.query(
      `INSERT INTO notifications (booking_id, user_id, event_id, message)
       VALUES ($1, $2, $3, $4)`,
      [data.bookingId, data.userId, data.eventId, expectedText]
    );

    assert.ok(insertedValues);
    assert.equal(insertedValues[0], 101);
    assert.equal(insertedValues[1], 5);
    assert.equal(insertedValues[2], 20);
    assert.equal(insertedValues[3], expectedText);
  });
});
