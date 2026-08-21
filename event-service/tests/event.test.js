const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { pool } = require('../src/db');
const { redis } = require('../src/cache');
const routes = require('../src/routes');
const { errorHandler } = require('../src/errorHandler');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/events', routes);
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

describe('Event Service Unit Tests', () => {
  let app;

  beforeEach(() => {
    app = createApp();
    redis.get = async () => null;
    redis.setEx = async () => 'OK';
    redis.del = async () => 1;
  });

  test('POST /events - creates event with valid parameters', async () => {
    const mockRow = {
      id: 1,
      title: 'Node.js Meetup',
      seats: 10,
      date: '2026-09-01T18:00:00.000Z',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    pool.query = async (sql, params) => {
      if (sql.includes('INSERT INTO events')) {
        return { rows: [mockRow] };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'POST', '/events', {
      title: 'Node.js Meetup',
      seats: 10,
      date: '2026-09-01T18:00:00.000Z',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.id, 1);
    assert.equal(res.body.title, 'Node.js Meetup');
    assert.equal(res.body.seats, 10);
  });

  test('POST /events - rejects invalid seats with 400', async () => {
    const res = await makeRequest(app, 'POST', '/events', {
      title: 'Node.js Meetup',
      seats: -5,
      date: '2026-09-01T18:00:00.000Z',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'seats must be a non-negative integer');
  });

  test('GET /events - returns paginated events list', async () => {
    const mockEvents = [
      { id: 1, title: 'Event 1', seats: 10, date: '2026-09-01T18:00:00.000Z', created_at: '', updated_at: '' },
      { id: 2, title: 'Event 2', seats: 20, date: '2026-09-02T18:00:00.000Z', created_at: '', updated_at: '' },
    ];

    pool.query = async (sql) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '2' }] };
      }
      if (sql.includes('SELECT id, title')) {
        return { rows: mockEvents };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'GET', '/events?page=1&limit=5');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 2);
    assert.equal(res.body.pagination.total, 2);
    assert.equal(res.body.pagination.page, 1);
    assert.equal(res.body.pagination.limit, 5);
  });

  test('GET /events/:id - serves from Redis cache when cached (cached: true)', async () => {
    const cachedEvent = {
      id: 1,
      title: 'Cached Event',
      seats: 5,
      date: '2026-09-01T18:00:00.000Z',
    };

    redis.get = async (key) => (key === 'event:1' ? JSON.stringify(cachedEvent) : null);

    const res = await makeRequest(app, 'GET', '/events/1');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 1);
    assert.equal(res.body.title, 'Cached Event');
    assert.equal(res.body.cached, true);
  });

  test('GET /events/:id - queries DB and sets cache on cache miss (cached: false)', async () => {
    let setCacheCalled = false;
    redis.get = async () => null;
    redis.setEx = async (key, ttl, val) => {
      if (key === 'event:2') setCacheCalled = true;
      return 'OK';
    };

    const mockRow = {
      id: 2,
      title: 'DB Event',
      seats: 8,
      date: '2026-09-01T18:00:00.000Z',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    pool.query = async (sql, params) => {
      if (params && params[0] === '2') {
        return { rows: [mockRow] };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'GET', '/events/2');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 2);
    assert.equal(res.body.cached, false);
    assert.equal(setCacheCalled, true);
  });

  test('POST /events/:id/reserve - decrements seats and invalidates cache', async () => {
    let invalidatedKey = null;
    redis.del = async (key) => { invalidatedKey = key; return 1; };

    const mockRow = {
      id: 1,
      title: 'Event 1',
      seats: 7,
      date: '2026-09-01T18:00:00.000Z',
      created_at: '',
      updated_at: '',
    };

    pool.query = async (sql) => {
      if (sql.includes('UPDATE events')) {
        return { rows: [mockRow] };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'POST', '/events/1/reserve', { seats: 3 });
    assert.equal(res.status, 200);
    assert.equal(res.body.seats, 7);
    assert.equal(invalidatedKey, 'event:1');
  });

  test('POST /events/:id/reserve - returns 409 when not enough seats', async () => {
    pool.query = async (sql) => {
      if (sql.includes('UPDATE events')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT id FROM events')) {
        return { rows: [{ id: 1 }] };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'POST', '/events/1/reserve', { seats: 50 });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'not enough seats');
  });

  test('DELETE /events/:id - deletes event and invalidates cache', async () => {
    let invalidatedKey = null;
    redis.del = async (key) => { invalidatedKey = key; return 1; };

    pool.query = async (sql) => {
      if (sql.includes('DELETE FROM events')) {
        return { rows: [{ id: 1 }] };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'DELETE', '/events/1');
    assert.equal(res.status, 204);
    assert.equal(invalidatedKey, 'event:1');
  });
});
