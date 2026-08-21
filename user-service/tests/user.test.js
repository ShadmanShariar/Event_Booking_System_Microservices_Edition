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
  app.use('/users', routes);
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

describe('User Service Unit Tests', () => {
  let app;
  let originalQuery;

  beforeEach(() => {
    app = createApp();
    originalQuery = pool.query;
  });

  test('POST /users - creates user successfully', async () => {
    const mockUser = {
      id: 1,
      name: 'Sarah Connor',
      email: 'sarah@example.com',
      created_at: new Date().toISOString(),
    };

    pool.query = async (sql, params) => {
      if (sql.includes('INSERT INTO users')) {
        return { rows: [mockUser] };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'POST', '/users', {
      name: 'Sarah Connor',
      email: 'sarah@example.com',
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.id, 1);
    assert.equal(res.body.name, 'Sarah Connor');
    assert.equal(res.body.email, 'sarah@example.com');
  });

  test('POST /users - rejects missing name or email with 400', async () => {
    const res1 = await makeRequest(app, 'POST', '/users', { name: 'Sarah' });
    assert.equal(res1.status, 400);
    assert.equal(res1.body.error, 'name and email are required');

    const res2 = await makeRequest(app, 'POST', '/users', { email: 'sarah@example.com' });
    assert.equal(res2.status, 400);
    assert.equal(res2.body.error, 'name and email are required');
  });

  test('POST /users - rejects invalid email format with 400', async () => {
    const res = await makeRequest(app, 'POST', '/users', {
      name: 'Sarah',
      email: 'not-a-valid-email',
    });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'email is invalid');
  });

  test('POST /users - returns 409 Conflict on duplicate email', async () => {
    pool.query = async () => {
      const err = new Error('duplicate key value violates unique constraint');
      err.code = '23505';
      throw err;
    };

    const res = await makeRequest(app, 'POST', '/users', {
      name: 'Sarah',
      email: 'existing@example.com',
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'email already exists');
  });

  test('GET /users - returns paginated users list (default limit=5)', async () => {
    const mockUsers = [
      { id: 1, name: 'User 1', email: 'user1@example.com' },
      { id: 2, name: 'User 2', email: 'user2@example.com' },
    ];

    pool.query = async (sql) => {
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ count: '2' }] };
      }
      if (sql.includes('SELECT id, name, email')) {
        return { rows: mockUsers };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'GET', '/users?page=1&limit=5');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 2);
    assert.equal(res.body.pagination.total, 2);
    assert.equal(res.body.pagination.page, 1);
    assert.equal(res.body.pagination.limit, 5);
    assert.equal(res.body.pagination.totalPages, 1);
    assert.equal(res.body.pagination.hasNext, false);
    assert.equal(res.body.pagination.hasPrev, false);
  });

  test('GET /users/:id - returns user when found', async () => {
    const mockUser = { id: 10, name: 'John Doe', email: 'john@example.com' };

    pool.query = async (sql, params) => {
      if (params && params[0] === '10') {
        return { rows: [mockUser] };
      }
      return { rows: [] };
    };

    const res = await makeRequest(app, 'GET', '/users/10');
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 10);
    assert.equal(res.body.name, 'John Doe');
  });

  test('GET /users/:id - returns 404 when user not found', async () => {
    pool.query = async () => ({ rows: [] });

    const res = await makeRequest(app, 'GET', '/users/999');
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'user not found');
  });
});
