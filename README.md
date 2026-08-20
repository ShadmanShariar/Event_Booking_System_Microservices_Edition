# Event Booking System

Node.js microservices for event seat booking. Services talk over REST for requests and NATS for booking confirmations.

## Architecture

```
Client
  |  REST
  v
user-service     event-service (Redis cache)
  ^                    ^
  | REST               | REST (atomic reserve/release)
  +-------- booking-service --------+
                     | NATS: booking.confirmed
                     v
            notification-service
```

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

## API endpoints

### User service (`:3001`)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/users` | Create user `{ name, email }` |
| GET | `/users` | List users |
| GET | `/users/:id` | Get user |

### Event service (`:3002`)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/events` | Create event `{ title, seats, date }` |
| GET | `/events` | List events |
| GET | `/events/:id` | Get event (Redis cache, 60s TTL) |
| PUT | `/events/:id` | Update event |
| DELETE | `/events/:id` | Delete event |
| POST | `/events/:id/reserve` | Internal: decrement seats atomically |
| POST | `/events/:id/release` | Internal: return seats if booking insert fails |

`GET /events/:id` includes `"cached": true|false`.

### Booking service (`:3003`)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/bookings` | Book seats `{ userId, eventId, seats }` |
| GET | `/bookings` | List bookings |
| GET | `/bookings/:id` | Get booking |

Rate limit: 20 requests per IP per 60 seconds (Redis).

### Notification service (`:3004`)

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/notifications` | Stored confirmation messages |

Postman collection: `postman/Event-Booking-System.postman_collection.json`

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
