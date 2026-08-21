# Event Booking System (Microservices Edition)

A production-grade, distributed Event Booking System built with **Node.js**, **PostgreSQL** (Database-per-Service), **Redis** (Caching & Rate Limiting), **NATS** (Asynchronous Event Streaming), **Docker Compose**, and **Kubernetes (Minikube)**.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Database Schema & Migrations](#database-schema--migrations)
3. [Setup Instructions (Docker Compose)](#setup-instructions-docker-compose)
4. [Setup Instructions (Minikube / Kubernetes)](#setup-instructions-minikube--kubernetes)
5. [Complete API Endpoint List](#complete-api-endpoint-list)
6. [Postman Collection & Step-by-Step Testing Guide](#postman-collection--step-by-step-testing-guide)
7. [Concurrency & Race-Condition Prevention](#concurrency--race-condition-prevention)
8. [Automated Unit Testing](#automated-unit-testing)

---

## Architecture Overview

<img width="1062" height="791" alt="Architecture Diagram" src="https://github.com/user-attachments/assets/4588b0dd-8265-4342-aa87-927091e787f8" />

### Microservices Catalog

| Service | Port | Database | Responsibilities & Integrations |
|---|:---:|---|---|
| **User Service** | `3001` | `user_db` | User registration, lookup, email format & unique constraint validation, pagination. |
| **Event Service** | `3002` | `event_db` | Event CRUD, **Redis Cache-Aside** (60s TTL), atomic seat reservation/release, pagination. |
| **Booking Service** | `3003` | `booking_db` | Orchestrator: **Redis Sliding Rate Limiter** (20 req/min/IP), User/Event validation, atomic seat reservation, DB persistence, **NATS Event Publishing** (`booking.confirmed`), compensating rollback saga. |
| **Notification Service** | `3004` | `notification_db` | **NATS Consumer** on `booking.confirmed`, event persistence, paginated notification history. |

### Infrastructure Components
- **PostgreSQL 16**: 4 isolated logical databases enforcing strict Database-per-Service boundaries.
- **Redis 7 (Alpine)**: Cache-aside layer for fast event lookups and distributed sliding-window rate limiting.
- **NATS 2**: High-throughput message broker for asynchronous event-driven notifications.

---

## Database Schema & Migrations

### 1. Database Isolation Pattern
Each service owns its private database. Cross-database queries and joins are strictly prohibited. Inter-service data requirements are handled via synchronous REST calls or asynchronous NATS events.

- `user_db` $\rightarrow$ **User Service**
- `event_db` $\rightarrow$ **Event Service**
- `booking_db` $\rightarrow$ **Booking Service**
- `notification_db` $\rightarrow$ **Notification Service**

Databases and users are provisioned automatically on startup via [`infra/postgres/init.sql`](file:///c:/Users/Shadman%20Shariar/Desktop/Event%20Booking%20System/infra/postgres/init.sql).

### 2. Automated Idempotent Migrations
Each service runs an automated schema migration on boot ([`src/migrate.js`](file:///c:/Users/Shadman%20Shariar/Desktop/Event%20Booking%20System/user-service/src/migrate.js)) with connection retry/exponential backoff.

#### **`users` Table** (`user_db`)
```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### **`events` Table** (`event_db`)
```sql
CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  seats INTEGER NOT NULL CHECK (seats >= 0),
  date TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### **`bookings` Table** (`booking_db`)
```sql
CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  seats INTEGER NOT NULL CHECK (seats > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

#### **`notifications` Table** (`notification_db`)
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  event_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## Setup Instructions (Docker Compose)

### 1. Start All Services
From the repository root, start all 4 microservices along with Postgres, Redis, and NATS:

```powershell
docker compose up --build
```
*(Add `-d` to run in detached background mode).*

### 2. Verify Health Checks
Verify that all services and their respective database connections are healthy:

```powershell
curl http://localhost:3001/health   # User Service
curl http://localhost:3002/health   # Event Service
curl http://localhost:3003/health   # Booking Service
curl http://localhost:3004/health   # Notification Service
```

### 3. Stop Services
To stop and remove containers while preserving data volumes:

```powershell
docker compose down
```

To stop and remove all containers, networks, and persistent database volumes:

```powershell
docker compose down -v
```

---

## Setup Instructions (Minikube / Kubernetes)

### 1. Start Minikube & Configure Docker Daemon
Start Minikube and point your local terminal's Docker client to Minikube's internal Docker daemon:

```powershell
minikube start --driver=docker
minikube -p minikube docker-env --shell powershell | Invoke-Expression
```

### 2. Build Container Images Inside Minikube
Build the 4 microservice container images directly inside Minikube's Docker runtime:

```powershell
docker build -t user-service:1.0 ./user-service
docker build -t event-service:1.0 ./event-service
docker build -t booking-service:1.0 ./booking-service
docker build -t notification-service:1.0 ./notification-service
```

### 3. Deploy All Kubernetes Manifests
Apply the complete Kubernetes configuration (Namespace, ConfigMaps, Secrets, Deployments, and Services):

```powershell
kubectl apply -f k8s/
```

### 4. Verify Pod & Service Status
Check that all 7 pods are in `Running` status (1/1 Ready):

```powershell
kubectl get pods -n event-booking
kubectl get svc -n event-booking
```

### 5. Accessing Services on Windows Minikube
On Windows with the Docker driver, retrieve accessible URLs via Minikube service commands or port forwarding:

**Option A: Minikube Service URL (Recommended)**
```powershell
minikube service user-service -n event-booking --url
minikube service event-service -n event-booking --url
minikube service booking-service -n event-booking --url
minikube service notification-service -n event-booking --url
```

**Option B: Direct Port-Forwarding**
```powershell
kubectl port-forward svc/user-service -n event-booking 3001:3001
kubectl port-forward svc/event-service -n event-booking 3002:3002
kubectl port-forward svc/booking-service -n event-booking 3003:3003
kubectl port-forward svc/notification-service -n event-booking 3004:3004
```

### 6. Zero-Downtime Rolling Update & Rollback Demo
Demonstrate zero-downtime rolling updates (`maxUnavailable: 0`, `maxSurge: 1`):

```powershell
# 1. Build new version
docker build -t booking-service:1.1 ./booking-service

# 2. Trigger rolling update
kubectl set image deployment/booking-service booking-service=booking-service:1.1 -n event-booking

# 3. Monitor live rollout status
kubectl rollout status deployment/booking-service -n event-booking

# 4. Instant rollback if needed
kubectl rollout undo deployment/booking-service -n event-booking
```

---

## Complete API Endpoint List

All listing endpoints support pagination with query parameters `?page=1&limit=5` and return standard envelope metadata.

### 1. User Service (`:3001`)

| Method | Endpoint | Request Body | Description | Status Codes |
|---|---|---|---|:---:|
| `GET` | `/health` | _None_ | Health check (Service & DB) | `200`, `500` |
| `POST` | `/users` | `{"name": "Aisha", "email": "aisha@example.com"}` | Register new user | `201`, `400`, `409` |
| `GET` | `/users?page=1&limit=5` | _None_ | List users (Paginated) | `200` |
| `GET` | `/users/:id` | _None_ | Get user by ID | `200`, `404` |

### 2. Event Service (`:3002`)

| Method | Endpoint | Request Body | Description | Status Codes |
|---|---|---|---|:---:|
| `GET` | `/health` | _None_ | Health check (Service & DB) | `200`, `500` |
| `POST` | `/events` | `{"title": "Meetup", "seats": 10, "date": "2026-09-01T18:00:00.000Z"}` | Create event | `201`, `400` |
| `GET` | `/events?page=1&limit=5` | _None_ | List events (Paginated) | `200` |
| `GET` | `/events/:id` | _None_ | Get event (**Redis Cached**, 60s TTL) | `200`, `404` |
| `PUT` | `/events/:id` | `{"title": "Meetup Updated", "seats": 15, ...}` | Update event (Invalidates cache) | `200`, `400`, `404` |
| `DELETE`| `/events/:id` | _None_ | Delete event (Invalidates cache) | `204`, `404` |
| `POST` | `/events/:id/reserve` | `{"seats": 2}` | Atomic seat decrement (Internal) | `200`, `400`, `404`, `409` |
| `POST` | `/events/:id/release` | `{"seats": 2}` | Release reserved seats (Internal) | `200`, `400`, `404` |

### 3. Booking Service (`:3003`)

| Method | Endpoint | Request Body | Description | Status Codes |
|---|---|---|---|:---:|
| `GET` | `/health` | _None_ | Health check (Service & DB) | `200`, `500` |
| `POST` | `/bookings` | `{"userId": 1, "eventId": 1, "seats": 2}` | Create booking (**Rate limited**, Orchestration + NATS) | `201`, `400`, `404`, `409`, `429`, `502` |
| `GET` | `/bookings?page=1&limit=5` | _None_ | List bookings (Paginated) | `200` |
| `GET` | `/bookings/:id` | _None_ | Get booking by ID | `200`, `404` |

### 4. Notification Service (`:3004`)

| Method | Endpoint | Request Body | Description | Status Codes |
|---|---|---|---|:---:|
| `GET` | `/health` | _None_ | Health check (Service & DB) | `200`, `500` |
| `GET` | `/notifications?page=1&limit=5`| _None_ | View messages consumed from NATS (Paginated) | `200` |

---

## Postman Collection & Step-by-Step Testing Guide

### 1. Import Postman Collection
Import [`postman/Event-Booking-System.postman_collection.json`](file:///c:/Users/Shadman%20Shariar/Desktop/Event%20Booking%20System/postman/Event-Booking-System.postman_collection.json) directly into Postman.

The collection includes predefined variables:
- `userUrl`: `http://localhost:3001`
- `eventUrl`: `http://localhost:3002`
- `bookingUrl`: `http://localhost:3003`
- `notificationUrl`: `http://localhost:3004`

---

### 2. Step-by-Step Testing Flow

#### **Step 1: Check Health Across All Services**
- `GET http://localhost:3001/health` $\rightarrow$ `200 OK`
- `GET http://localhost:3002/health` $\rightarrow$ `200 OK`
- `GET http://localhost:3003/health` $\rightarrow$ `200 OK`
- `GET http://localhost:3004/health` $\rightarrow$ `200 OK`

#### **Step 2: Create Users**
- **Method**: `POST`
- **URL**: `http://localhost:3001/users`
- **Body**:
  ```json
  {
    "name": "Sarah Connor",
    "email": "sarah@example.com"
  }
  ```
- **Response**: `201 Created` with created user ID `1`.

#### **Step 3: List Users (Paginated)**
- **Method**: `GET`
- **URL**: `http://localhost:3001/users?page=1&limit=5`
- **Response**:
  ```json
  {
    "data": [{ "id": 1, "name": "Sarah Connor", "email": "sarah@example.com" }],
    "pagination": { "total": 1, "page": 1, "limit": 5, "totalPages": 1, "hasNext": false, "hasPrev": false }
  }
  ```

#### **Step 4: Create Event**
- **Method**: `POST`
- **URL**: `http://localhost:3002/events`
- **Body**:
  ```json
  {
    "title": "Cloud Native Summit 2026",
    "seats": 5,
    "date": "2026-11-20T10:00:00.000Z"
  }
  ```
- **Response**: `201 Created` with event ID `1` and `seats: 5`.

#### **Step 5: Test Redis Cache Hit & Miss**
- **First Call**: `GET http://localhost:3002/events/1` $\rightarrow$ Returns `"cached": false` (queried PostgreSQL and saved to Redis).
- **Second Call**: `GET http://localhost:3002/events/1` $\rightarrow$ Returns `"cached": true` (served instantly from Redis).

#### **Step 6: Create Booking (End-to-End Orchestration + NATS)**
- **Method**: `POST`
- **URL**: `http://localhost:3003/bookings`
- **Body**:
  ```json
  {
    "userId": 1,
    "eventId": 1,
    "seats": 2
  }
  ```
- **What Happens**:
  1. Validates user existence with `user-service`.
  2. Validates event existence with `event-service`.
  3. Atomically reserves 2 seats in `event-service` (seats remaining: 3).
  4. Stores booking in `booking_db`.
  5. Publishes `booking.confirmed` event to NATS.
- **Response**: `201 Created` with `status: "confirmed"`.

#### **Step 7: Verify Asynchronous Notification Consumption**
- **Method**: `GET`
- **URL**: `http://localhost:3004/notifications?page=1&limit=5`
- **Response**: `200 OK`
  ```json
  {
    "data": [
      {
        "id": 1,
        "booking_id": 1,
        "user_id": 1,
        "event_id": 1,
        "message": "Booking confirmed for Sarah Connor (sarah@example.com): 2 seat(s) for \"Cloud Native Summit 2026\". Booking ID 1."
      }
    ],
    "pagination": { "total": 1, "page": 1, "limit": 5, "totalPages": 1, "hasNext": false, "hasPrev": false }
  }
  ```

#### **Step 8: Verify Oversell Rejection**
- Try booking 10 seats when only 3 remain:
  - **Method**: `POST` `http://localhost:3003/bookings`
  - **Body**: `{"userId": 1, "eventId": 1, "seats": 10}`
  - **Response**: `409 Conflict` $\rightarrow$ `{"error": "not enough seats"}`

#### **Step 9: Test Redis Rate Limiting**
- Send more than 20 requests within 60 seconds to `POST http://localhost:3003/bookings`.
- **Response**: `429 Too Many Requests` $\rightarrow$ `{"error": "too many requests"}`.

---

## Concurrency & Race-Condition Prevention

To prevent overselling when hundreds of users attempt to book simultaneously, seats are reserved using a single atomic SQL statement with PostgreSQL row-level locking:

```sql
UPDATE events
SET seats = seats - $1,
    updated_at = CURRENT_TIMESTAMP
WHERE id = $2 AND seats >= $1
RETURNING id, title, seats, date, created_at, updated_at;
```

### Why this prevents race conditions:
1. **Atomic Evaluation**: The condition `seats >= $1` and the decrement `seats = seats - $1` are evaluated atomically inside PostgreSQL engine.
2. **Row-Level Locks**: PostgreSQL automatically acquires an exclusive row lock (`FOR UPDATE`) on the target event during the transaction.
3. **Zero Leaks with Compensating Transactions**: If the booking service experiences a network partition or database error after reserving seats, it immediately invokes a compensating release call (`POST /events/:id/release`) to restore the seats.

---

## Automated Unit Testing

Each microservice contains an isolated unit test suite using Node.js's native test runner (`node:test` and `node:assert/strict`).

```powershell
# Run User Service unit tests
docker run --rm -v "${PWD}/user-service:/app" -w /app node:20-alpine node --test tests/

# Run Event Service unit tests
docker run --rm -v "${PWD}/event-service:/app" -w /app node:20-alpine node --test tests/

# Run Booking Service unit tests
docker run --rm -v "${PWD}/booking-service:/app" -w /app node:20-alpine node --test tests/

# Run Notification Service unit tests
docker run --rm -v "${PWD}/notification-service:/app" -w /app node:20-alpine node --test tests/
```

### Unit Test Summary: **24 / 24 PASSED (100%)**
- **User Service (7/7)**: User creation, missing fields validation, email regex validation, duplicate email constraint, paginated queries, 404 lookup handling.
- **Event Service (8/8)**: Event CRUD, seat validation, Redis cache hit (`cached: true`), Redis cache miss (`cached: false`), atomic seat reservation, insufficient seat rejection (`409`), cache invalidation on delete.
- **Booking Service (7/7)**: Redis sliding rate limiter (`429`), input validation, missing user handling, insufficient seats handling, full orchestration + NATS publishing, compensating release rollback saga on DB crash, paginated list.
- **Notification Service (2/2)**: Paginated notifications query, NATS event decoding and database persistence logic.
