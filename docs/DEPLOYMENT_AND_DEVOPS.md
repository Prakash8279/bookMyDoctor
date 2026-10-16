# BookMyDoctor24 — Deployment, DevOps & Infrastructure Architecture

This document outlines the deployment topology, container orchestration, Nginx load balancing, environment variable master reference, zero-downtime database migration workflow, and disaster recovery procedures for **BookMyDoctor24**.

---

## 🌐 Production Topology & Infrastructure Model

The architecture separates stateful persistence, stateless HTTP request handling, background queuing, and edge delivery:

```mermaid
flowchart TD
    Internet([Public Internet])

    subgraph CDNLayer["Edge & CDN Tier"]
        Cloudflare["Cloudflare / AWS CloudFront<br/>(DDoS Protection, SSL Termination, Static Caching)"]
    end

    subgraph ComputeTier["Container / Orchestration Tier"]
        NginxLB["Nginx Reverse Proxy & Load Balancer<br/>(Port 4000 / Port 80)"]

        subgraph APIServers["Stateless API Replicas"]
            API1["Express API Instance 1<br/>(UV_THREADPOOL_SIZE=16)"]
            API2["Express API Instance 2<br/>(UV_THREADPOOL_SIZE=16)"]
            API3["Express API Instance 3<br/>(UV_THREADPOOL_SIZE=16)"]
        end

        subgraph WorkerCluster["Background Queue Workers"]
            Worker1["BullMQ Worker Instance 1<br/>(Concurrency: 8)"]
            Worker2["BullMQ Worker Instance 2<br/>(Concurrency: 8)"]
        end
    end

    subgraph DataPersistenceTier["Managed Data Persistence"]
        Postgres[("PostgreSQL 16 High-Availability<br/>(Primary + Read Replica)")]
        RedisHA[("Redis 7 Cluster / AOF Persistence<br/>(BullMQ, Distributed Locks, Cache)")]
        S3Storage[("AWS S3 / MinIO Object Storage<br/>(Avatars & Private KYC Documents)")]
    end

    subgraph Monitoring["Observability & Third-Party APIs"]
        Sentry["Sentry Error Tracking"]
        Razorpay["Razorpay Gateway"]
    end

    Internet --> Cloudflare
    Cloudflare -->|Static Web Assets| Internet
    Cloudflare -->|API Requests /api/*| NginxLB

    NginxLB -->|Round-Robin Upstream| API1
    NginxLB -->|Round-Robin Upstream| API2
    NginxLB -->|Round-Robin Upstream| API3

    API1 & API2 & API3 -->|Prisma Connection Pool| Postgres
    API1 & API2 & API3 -->|Cache-Aside / Locks| RedisHA
    API1 & API2 & API3 -->|Pre-signed URLs / Uploads| S3Storage

    Worker1 & Worker2 -->|Consume BullMQ Streams| RedisHA
    Worker1 & Worker2 -->|Transactions & State| Postgres

    API1 & API2 & API3 & Worker1 & Worker2 -.->|Capture Exceptions| Sentry
    API1 & API2 & API3 <-->|Orders & Webhook HMAC| Razorpay
```

---

## 🐳 Docker Compose Orchestration (`docker-compose.yml`)

The repository includes a production-ready, multi-container Compose setup for local testing and staging environments:

### Services Defined:
1. **`postgres` (PostgreSQL 16):**
   - Configured with persistent Docker volume `postgres_data`.
   - Healthcheck: `pg_isready -U doctor_connect -d doctor_connect` (interval: 5s, retries: 10).
2. **`redis` (Redis 7):**
   - **Persistence:** Configured with `--appendonly yes` and volume `redis_data` so booking queue jobs and distributed locks survive restarts.
   - **Auth:** Requires password authentication (`requirepass $$REDIS_PASSWORD`).
   - Healthcheck: `redis-cli -a $$REDIS_PASSWORD ping`.
3. **`server` (API Service):**
   - Built from `server/server/Dockerfile`.
   - Scalable to $N$ replicas (`--scale server=3`).
   - Depends on healthy `postgres` and `redis`.
4. **`worker` (BullMQ Booking Worker):**
   - Built from the identical Docker image as `server`, executing `npm run worker`.
   - Scalable to $N$ worker instances (`--scale worker=2`).
5. **`nginx` (Reverse Proxy & Load Balancer):**
   - Listens on host port `4000`.
   - Distributes incoming HTTP traffic across all running `server` replicas.

### Multi-Replica Startup Command:
```bash
# Spin up with 3 API replicas and 2 background booking workers:
docker compose up -d --build --scale server=3 --scale worker=2
```

---

## ⚖️ Nginx Reverse Proxy Configuration (`nginx/api.conf`)

Nginx routes requests to API replicas using round-robin DNS upstream balancing:

```nginx
upstream api_cluster {
    # Docker internal DNS resolves all running replicas of 'server'
    server server:4000;
    keepalive 32;
}

server {
    listen 4000;
    server_name _;

    client_max_body_size 15M; # Supports doctor KYC document & photo uploads

    location / {
        proxy_pass http://api_cluster;
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        # Real Client IP propagation
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (for live subscriptions / HMR)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Timeouts for long-running batch operations
        proxy_connect_timeout 10s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

---

## 📋 Environment Configuration Master Reference

Every configuration option available across `server/server/.env.example` is documented below:

| Variable Name | Required | Default / Example | Purpose & Security Guidance |
|---|:---:|---|---|
| `NODE_ENV` | Yes | `production` | Enables production optimizations, disables stack trace leaks |
| `PORT` | Yes | `4000` | Port on which the Express HTTP server listens |
| `CLIENT_ORIGIN` | Yes | `https://bookmydoctor.com` | Strict CORS allowlist; must match frontend domain |
| `BUSINESS_TIME_ZONE` | Yes | `Asia/Kolkata` | Standard operational timezone for OPD slots & reports |
| `TRUST_PROXY_HOPS` | Yes | `1` | Exact reverse proxy count for reliable `req.ip` extraction |
| `DATABASE_URL` | Yes | `postgresql://user:pass@host:5432/db` | PostgreSQL connection string |
| `DB_POOL_SIZE` | No | `5` | Connection pool ceiling per process |
| `DB_POOL_TIMEOUT_SECONDS` | No | `10` | Seconds to wait for free connection before failing fast |
| `REDIS_URL` | Yes | `redis://:pass@host:6379` | Redis connection URI with authentication |
| `JWT_ACCESS_SECRET` | Yes | *64-hex string* | Primary signing secret for short-lived 15m access tokens |
| `JWT_REFRESH_SECRET` | Yes | *64-hex string* | Primary secret for 30d refresh tokens |
| `JWT_ACCESS_SECRET_PREVIOUS` | No | *Empty* | Used during zero-downtime JWT secret rotation overlap |
| `JWT_REFRESH_SECRET_PREVIOUS`| No | *Empty* | Used during zero-downtime JWT secret rotation overlap |
| `BCRYPT_SALT_ROUNDS` | Yes | `12` | Computational cost factor for password hashing |
| `AUTH_MAX_INFLIGHT` | Yes | `90` | Process cap for concurrent bcrypt operations (sheds with 503) |
| `AUTH_RETRY_AFTER_SECONDS` | Yes | `3` | `Retry-After` header value returned on 503 Service Busy |
| `ADMIN_IP_ALLOWLIST` | No | `203.0.113.10,203.0.113.11` | Optional IP whitelist for `/admin/*` routes |
| `BANK_DETAILS_ENCRYPTION_KEY`| Yes | *64-hex string* | 32-byte key for AES-256-GCM encryption of doctor bank PII |
| `RAZORPAY_KEY_ID` | Yes | `rzp_live_...` | Razorpay public key identifier |
| `RAZORPAY_KEY_SECRET` | Yes | *Secret string* | Razorpay API secret key for order creation & refunds |
| `RAZORPAY_WEBHOOK_SECRET` | Yes | *Webhook secret* | Secret used to verify `X-Razorpay-Signature` HMAC |
| `GOOGLE_CLIENT_ID` | No | `123...apps.google...` | Client ID for verifying Google Identity tokens |
| `EMAIL_PROVIDER` | Yes | `smtp` / `gmail` / `log` | Email transport mode (`log` only permitted in dev) |
| `EMAIL_FROM` | Yes | `BookADoctors <noreply@...>`| Authorized sender address for OTPs and notifications |
| `SMTP_HOST` / `SMTP_PORT` | Yes | `smtp.provider.com` / `587`| Authenticated SMTP host credentials |
| `SMS_PROVIDER` | No | `fast2sms` / `twilio` / `log`| SMS gateway provider for OTPs |
| `SENTRY_DSN` | No | `https://...@sentry.io/...` | Sentry endpoint for 5xx exception alerts |
| `REFRESH_COOKIE_SAME_SITE` | No | `lax` | SameSite cookie policy (`lax` default, `none` for multi-domain) |

---

## 🗃️ Database Migration Strategy (Zero-Downtime)

Prisma migrations run sequentially during deployments:

```bash
# 1. Apply schema migrations non-interactively
npx prisma migrate deploy

# 2. Check migration status
npx prisma migrate status
```

### Expand-and-Contract Migration Pattern
When making schema modifications to active production databases:
1. **Expand Phase:** Add new columns as **nullable** or with default values. Old and new code can run simultaneously.
2. **Deploy Phase:** Deploy updated backend and frontend code that populates and reads the new column.
3. **Contract Phase:** Backfill data in historical rows; add `NOT NULL` constraints in a subsequent deployment.

---

## ⚙️ PaaS / Process Management (Procfile & PM2)

For deployment to cloud platforms (Render, Heroku, Railway, or direct Ubuntu VPS via PM2):

### `Procfile` Specification:
```text
web: cross-env UV_THREADPOOL_SIZE=16 node src/server.js
worker: node src/jobs/worker.process.js
```

### PM2 Configuration (`ecosystem.config.js`):
```javascript
module.exports = {
  apps: [
    {
      name: 'api-server',
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        UV_THREADPOOL_SIZE: 16,
        NODE_ENV: 'production'
      }
    },
    {
      name: 'booking-worker',
      script: 'src/jobs/worker.process.js',
      instances: 2,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
```

---

## 🔄 Disaster Recovery & Backup Plan

1. **PostgreSQL Backups:**
   - Execute daily automated `pg_dump` snapshots to an offsite S3 bucket:
     ```bash
     pg_dump -Fc --no-acl --no-owner -h $DB_HOST -U $DB_USER $DB_NAME > /backups/db_$(date +%Y%m%d).dump
     ```
   - Retain 30 days of rolling snapshots with point-in-time recovery (WAL archiving).
2. **Redis Durability:**
   - Always run with `appendonly yes`. In case of node failure, Redis rebuilds queue state from the Append-Only File (AOF).
3. **Health Check Probing:**
   - Set uptime monitors (Pingdom, BetterUptime, AWS Route53) targeting `GET /health` with a 15-second probe frequency.
