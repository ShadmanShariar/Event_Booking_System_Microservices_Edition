# Event Booking System

Node.js microservices for event seat booking. Services talk over REST for requests and NATS for booking confirmations.

## Architecture

<img width="1062" height="791" alt="diagram-export-8-21-2026-1_49_03-AM" src="https://github.com/user-attachments/assets/4588b0dd-8265-4342-aa87-927091e787f8" />



| Service | Port | Database | Extra |
|---|---|---|---|
| user-service | 3001 | `user_db` | |
| event-service | 3002 | `event_db` | Redis cache |
| booking-service | 3003 | `booking_db` | Redis rate limit, NATS publish |
| notification-service | 3004 | `notification_db` | NATS subscribe |

Infra: PostgreSQL 16, Redis 7, NATS 2.

## Project structure

```
user-service/
event-service/
booking-service/
notification-service/
infra/postgres/init.sql
k8s/
postman/
docker-compose.yml
```

Each service has its own `Dockerfile`, `package.json`, and `src/`.

## Database schema and migrations

Each service creates its tables on startup (`src/migrate.js`). Postgres databases are created by `infra/postgres/init.sql`.

**users** (`user_db`)

| Column | Type |
|---|---|
| id | SERIAL PK |
| name | VARCHAR(100) |
| email | VARCHAR(255) UNIQUE |
| created_at | TIMESTAMP |

**events** (`event_db`)

| Column | Type |
|---|---|
| id | SERIAL PK |
| title | VARCHAR(255) |
| seats | INTEGER (>= 0) |
| date | TIMESTAMP |
| created_at | TIMESTAMP |
| updated_at | TIMESTAMP |

**bookings** (`booking_db`)

| Column | Type |
|---|---|
| id | SERIAL PK |
| user_id | INTEGER |
| event_id | INTEGER |
| seats | INTEGER (> 0) |
| status | VARCHAR(20) |
| created_at | TIMESTAMP |

**notifications** (`notification_db`)

| Column | Type |
|---|---|
| id | SERIAL PK |
| booking_id | INTEGER |
| user_id | INTEGER |
| event_id | INTEGER |
| message | TEXT |
| created_at | TIMESTAMP |

## 1. Complete API Reference

### User Service (`:3001`)

| # | Method | Endpoint | Description |
|---|---|---|---|
| 1 | `GET` | `http://localhost:3001/health` | Service & DB Health Check |
| 2 | `POST` | `http://localhost:3001/users` | Register a new user `{ name, email }` |
| 3 | `GET` | `http://localhost:3001/users?page=1&limit=5` | List users (Paginated, default: 5/page) |
| 4 | `GET` | `http://localhost:3001/users/:id` | Get user details by ID |

<img width="669" height="547" alt="Annotation 2026-08-21 183654" src="https://github.com/user-attachments/assets/f5639c22-fc08-486d-a6c0-f3d3a4641c22" />

### Event Service (`:3002`)

| # | Method | Endpoint | Description |
|---|---|---|---|
| 5 | `GET` | `http://localhost:3002/health` | Service & DB Health Check |
| 6 | `POST` | `http://localhost:3002/events` | Create an event with seat capacity `{ title, seats, date }` |
| 7 | `GET` | `http://localhost:3002/events?page=1&limit=5` | List events (Paginated, default: 5/page) |
| 8 | `GET` | `http://localhost:3002/events/:id` | Get event (Redis Cache, 60s TTL) |
| 9 | `PUT` | `http://localhost:3002/events/:id` | Update event (invalidates cache) |
| 10 | `DELETE` | `http://localhost:3002/events/:id` | Delete event (invalidates cache) |
| 11 | `POST` | `http://localhost:3002/events/:id/reserve` | Atomic seat decrement (Internal) |
| 12 | `POST` | `http://localhost:3002/events/:id/release` | Release seats back (Internal) |

`GET /events/:id` includes `"cached": true|false`.

### Booking Service (`:3003`)

<img width="693" height="375" alt="Annotation 2026-08-21 183713" src="https://github.com/user-attachments/assets/a1c47536-43f2-4167-9e83-eaba56911d72" />


<img width="1703" height="1271" alt="diagram-export-8-21-2026-2_01_05-AM" src="https://github.com/user-attachments/assets/b4fbf2ba-2665-47ba-afb4-777e9b3d1f28" />


| # | Method | Endpoint | Description |
|---|---|---|---|
| 13 | `GET` | `http://localhost:3003/health` | Service & DB Health Check |
| 14 | `POST` | `http://localhost:3003/bookings` | Book seats `{ userId, eventId, seats }` (Orchestrates User + Event + NATS) |
| 15 | `GET` | `http://localhost:3003/bookings?page=1&limit=5` | List bookings (Paginated, default: 5/page) |
| 16 | `GET` | `http://localhost:3003/bookings/:id` | Get booking details by ID |

Rate limit: 20 requests per IP per 60 seconds (Redis).

### Notification Service (`:3004`)

| # | Method | Endpoint | Description |
|---|---|---|---|
| 17 | `GET` | `http://localhost:3004/health` | Service & DB Health Check |
| 18 | `GET` | `http://localhost:3004/notifications?page=1&limit=5` | View notifications (Paginated, default: 5/page) |

All listing endpoints return pagination metadata:
```json
{
  "data": [...],
  "pagination": {
    "total": 12,
    "page": 1,
    "limit": 5,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

Postman collection: `postman/Event-Booking-System.postman_collection.json`

## 2. Step-by-Step Postman Testing Flow

Follow these steps sequentially to test the full distributed lifecycle:

### Step 1: Verify All Services are Healthy
Send `GET` requests to check service and database connectivity:
- `GET http://localhost:3001/health` -> `{"status": "ok", "service": "user-service"}`
- `GET http://localhost:3002/health` -> `{"status": "ok", "service": "event-service"}`
- `GET http://localhost:3003/health` -> `{"status": "ok", "service": "booking-service"}`
- `GET http://localhost:3004/health` -> `{"status": "ok", "service": "notification-service"}`

### Step 2: Create a User
- **Method**: `POST`
- **URL**: `http://localhost:3001/users`
- **Headers**: `Content-Type: application/json`
- **Body** (raw JSON):
```json
{
  "name": "Sarah Connor",
  "email": "sarah.connor@example.com"
}
```
- **Expected Status**: `201 Created`
- **Response**: Note the generated `id` (e.g. `1`).

### Step 3: Create an Event
- **Method**: `POST`
- **URL**: `http://localhost:3002/events`
- **Headers**: `Content-Type: application/json`
- **Body** (raw JSON):
```json
{
  "title": "Cloud Native Summit 2026",
  "seats": 10,
  "date": "2026-11-20T10:00:00.000Z"
}
```
- **Expected Status**: `201 Created`
- **Response**: Note the generated `id` (e.g. `1`).

### Step 4: Test Redis Caching on Event Service
- **Method**: `GET`
- **URL**: `http://localhost:3002/events/1`
- **First Request (Cache Miss)**:
  - Response contains: `"cached": false`
  - Data is retrieved from PostgreSQL and cached in Redis.
- **Second Request immediately after (Cache Hit)**:
  - Response contains: `"cached": true`
  - Data is retrieved directly from Redis.

### Step 5: Book Seats (End-to-End Orchestration)
This call checks the user, atomically reserves seats in the event service, creates a booking record, and publishes a `booking.confirmed` event to NATS.

- **Method**: `POST`
- **URL**: `http://localhost:3003/bookings`
- **Headers**: `Content-Type: application/json`
- **Body** (raw JSON):
```json
{
  "userId": 1,
  "eventId": 1,
  "seats": 3
}
```
- **Expected Status**: `201 Created`
- **Response**:
```json
{
  "id": 1,
  "user_id": 1,
  "event_id": 1,
  "seats": 3,
  "status": "confirmed",
  "created_at": "..."
}
```

### Step 6: Verify Atomic Seat Decrement
- **Method**: `GET`
- **URL**: `http://localhost:3002/events/1`
- **Expected Result**: Seats should now be `7` (10 original minus 3 booked).

### Step 7: Verify Notification Consumer (NATS)
- **Method**: `GET`
- **URL**: `http://localhost:3004/notifications`
- **Expected Status**: `200 OK`
- **Response**: The notification service automatically consumed the event from NATS and saved the record:
```json
[
  {
    "id": 1,
    "booking_id": 1,
    "user_id": 1,
    "event_id": 1,
    "message": "Booking confirmed for Sarah Connor (sarah.connor@example.com): 3 seat(s) for \"Cloud Native Summit 2026\". Booking ID 1.",
    "created_at": "..."
  }
]
```

### Step 8: Test Concurrency & Edge Cases

#### A. Overbooking Prevention (Not enough seats)
- **Method**: `POST` `http://localhost:3003/bookings`
- **Body**: `{"userId": 1, "eventId": 1, "seats": 50}`
- **Expected Status**: `409 Conflict` (`{"error": "not enough seats"}`)

#### B. Duplicate User Email Prevention
- **Method**: `POST` `http://localhost:3001/users`
- **Body**: `{"name": "Sarah", "email": "sarah.connor@example.com"}`
- **Expected Status**: `409 Conflict` (`{"error": "email already exists"}`)

#### C. Invalid Email Format
- **Method**: `POST` `http://localhost:3001/users`
- **Body**: `{"name": "Bad Email", "email": "not-valid"}`
- **Expected Status**: `400 Bad Request` (`{"error": "email is invalid"}`)

#### D. Non-Existent Entity
- **Method**: `GET` `http://localhost:3001/users/99999`
- **Expected Status**: `404 Not Found` (`{"error": "user not found"}`)

### Step 9: Update Event & Test Cache Invalidation
- **Method**: `PUT`
- **URL**: `http://localhost:3002/events/1`
- **Body**:
```json
{
  "title": "Cloud Native Summit 2026 - Updated",
  "seats": 20,
  "date": "2026-11-20T10:00:00.000Z"
}
```
- **Expected Status**: `200 OK`
- Next call to `GET http://localhost:3002/events/1` will return `"cached": false` with the new title, verifying that update invalidated the Redis cache.

### Step 10: Delete Event
- **Method**: `DELETE`
- **URL**: `http://localhost:3002/events/1`
- **Expected Status**: `204 No Content`
- A subsequent `GET http://localhost:3002/events/1` will return `404 Not Found`.

## Race-condition-safe booking

Seats are decremented with a single SQL statement:

```sql
UPDATE events
SET seats = seats - $1
WHERE id = $2 AND seats >= $1
RETURNING *;
```

PostgreSQL locks the event row during the update. Concurrent bookings cannot oversell. If the booking row cannot be saved, seats are released.

## Run with Docker Compose

From the project root:

```powershell
docker compose up --build
```

Health checks:

```powershell
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
curl http://localhost:3004/health
```

Sample flow:

```powershell
curl -X POST http://localhost:3001/users -H "Content-Type: application/json" -d "{\"name\":\"Aisha Khan\",\"email\":\"aisha@example.com\"}"

curl -X POST http://localhost:3002/events -H "Content-Type: application/json" -d "{\"title\":\"Node.js Meetup\",\"seats\":2,\"date\":\"2026-09-01T18:00:00.000Z\"}"

curl -X POST http://localhost:3003/bookings -H "Content-Type: application/json" -d "{\"userId\":1,\"eventId\":1,\"seats\":1}"

curl http://localhost:3004/notifications
```

Call `GET /events/1` twice to see Redis cache (`cached: true` on the second call).

Stop:

```powershell
docker compose down
```

## Deploy on Minikube

1. Start Minikube and use its Docker daemon so images are available inside the cluster:

```powershell
minikube start
minikube docker-env | Invoke-Expression
```

2. Build images:

```powershell
docker build -t user-service:1.0 ./user-service
docker build -t event-service:1.0 ./event-service
docker build -t booking-service:1.0 ./booking-service
docker build -t notification-service:1.0 ./notification-service
```

3. Apply manifests:

```powershell
kubectl apply -f k8s/
kubectl get pods -n event-booking
```

Wait until all pods are `Running`.

4. Call APIs through Minikube:

```powershell
minikube service user-service -n event-booking --url
minikube service event-service -n event-booking --url
minikube service booking-service -n event-booking --url
minikube service notification-service -n event-booking --url
```

Or NodePorts `30001`–`30004` on the Minikube IP:

```powershell
minikube ip
```

Example: `http://<minikube-ip>:30001/users`

### Inter-service communication in Kubernetes

Cluster DNS names (same namespace):

- `http://user-service:3001`
- `http://event-service:3002`
- `http://event-service:3002/events/:id/reserve`
- `nats://nats:4222` subject `booking.confirmed`
- `redis://redis:6379`
- `postgres:5432`

Booking service uses `USER_SERVICE_URL` and `EVENT_SERVICE_URL` for REST. After a booking it publishes to NATS. Notification service consumes that message and stores it.

### Rolling update (Minikube)

Deployments use `RollingUpdate` (`maxUnavailable: 0`, `maxSurge: 1`). After rebuilding an image with a new tag:

```powershell
docker build -t booking-service:1.1 ./booking-service
kubectl set image deployment/booking-service booking-service=booking-service:1.1 -n event-booking
kubectl rollout status deployment/booking-service -n event-booking
```

Rollback:

```powershell
kubectl rollout undo deployment/booking-service -n event-booking
```

## How booking confirmation works

1. Booking service checks the user (user-service) and event (event-service).
2. Event service reserves seats atomically.
3. Booking service saves the booking.
4. Booking service publishes `booking.confirmed` to NATS.
5. Notification service writes a confirmation message and logs it.
