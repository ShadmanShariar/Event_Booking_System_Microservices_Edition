const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { pool } = require('../src/db');
const redis = require('../src/redis');
const httpClient = require('../src/http');
const nats = require('../src/nats');
const routes = require('../src/routes');
const { errorHandler } = require('../src/errorHandler');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/bookings', routes);
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

describe('Booking Service Unit Tests', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    redis.rateLimit = async () => true;
  });

  test('POST /bookings - blocks request with 429 when rate limit exceeded', async () => {
    redis.rateLimit = async () => false;

    const res = await makeRequest(app, 'POST', '/bookings', {
      userId: 1,
      eventId: 1,
      seats: 1,
    });

    assert.equal(res.status, 429);
    assert.equal(res.body.error, 'too many requests');
  });

  test('POST /bookings - rejects missing fields or invalid seats with 400', async () => {
    const res1 = await makeRequest(app, 'POST', '/bookings', { userId: 1 });
    assert.equal(res1.status, 400);

    const res2 = await makeRequest(app, 'POST', '/bookings', { userId: 1, eventId: 1, seats: 0 });
    assert.equal(res2.status, 400);
    assert.equal(res2.body.error, 'seats must be a positive integer');
  });

  test('POST /bookings - returns 404 when user is not found', async () => {
    httpClient.getJson = async (url) => {
      if (url.includes('/users/999')) {
        return { status: 404, body: { error: 'user not found' } };
      }
      return { status: 200, body: {} };
    };

    const res = await makeRequest(app, 'POST', '/bookings', {
      userId: 999,
      eventId: 1,
      seats: 1,
    });

    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'user not found');
  });

  test('POST /bookings - returns 409 when event has not enough seats', async () => {
    httpClient.getJson = async (url) => {
      if (url.includes('/users/1')) return { status: 200, body: { id: 1, name: 'User 1' } };
      if (url.includes('/events/1')) return { status: 200, body: { id: 1, title: 'Event 1' } };
      return { status: 200, body: {} };
    };

    httpClient.postJson = async (url) => {
      if (url.includes('/reserve')) {
        return { status: 409, body: { error: 'not enough seats' } };
      }
      return { status: 200, body: {} };
    };

    const res = await makeRequest(app, 'POST', '/bookings', {
      userId: 1,
      eventId: 1,
      seats: 50,
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'not enough seats');
  });

  test('POST /bookings - orchestrates full flow, inserts booking and publishes to NATS', async () => {
    let natsPublished = null;
    nats.publishBookingConfirmed = async (payload) => {
      natsPublished = payload;
    };

    httpClient.getJson = async (url) => {
      if (url.includes('/users/1')) {
        return { status: 200, body: { id: 1, name: 'Sarah Connor', email: 'sarah@example.com' } };
      }
      if (url.includes('/events/1')) {
        return { status: 200, body: { id: 1, title: 'Summit 2026' } };
      }
      return { status: 200, body: {} };
    };

    httpClient.postJson = async (url) => {
      if (url.includes('/reserve')) {
        return { status: 200, body: { id: 1, seats: 7 } };
      }
      return { status: 200, body: {} };
    };

    const mockBooking = {
      id: 1,
      user_id: 1,
      event_id: 1,
      seats: 3,
      status: 'confirmed',
      created_at: new Date().toISOString(),
    };

    pool.query = async (sql) => {
      if (sql.includes('INSERT INTO bookings')) {
        return { rows: [mockBooking] };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'POST', '/bookings', {
      userId: 1,
      eventId: 1,
      seats: 3,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.id, 1);
    assert.equal(res.body.status, 'confirmed');
    assert.ok(natsPublished);
    assert.equal(natsPublished.bookingId, 1);
    assert.equal(natsPublished.userName, 'Sarah Connor');
  });

  test('POST /bookings - triggers compensating release when DB insert fails', async () => {
    let releaseCalled = false;

    httpClient.getJson = async () => ({ status: 200, body: { id: 1, name: 'A', email: 'a@a.com', title: 'T' } });
    httpClient.postJson = async (url) => {
      if (url.includes('/reserve')) return { status: 200, body: {} };
      if (url.includes('/release')) {
        releaseCalled = true;
        return { status: 200, body: {} };
      }
      return { status: 200, body: {} };
    };

    pool.query = async () => {
      throw new Error('Database connection lost during insert');
    };

    const res = await makeRequest(app, 'POST', '/bookings', {
      userId: 1,
      eventId: 1,
      seats: 2,
    });

    assert.equal(res.status, 500);
    assert.equal(releaseCalled, true);
  });

  test('GET /bookings - returns paginated bookings list', async () => {
    const mockBookings = [
      { id: 1, user_id: 1, event_id: 1, seats: 2, status: 'confirmed', created_at: '' },
    ];

    pool.query = async (sql) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '1' }] };
      }
      if (sql.includes('SELECT id, user_id')) {
        return { rows: mockBookings };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'GET', '/bookings?page=1&limit=5');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.pagination.total, 1);
    assert.equal(res.body.pagination.page, 1);
  });
});
