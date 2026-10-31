#!/bin/bash
set -e

echo "=========================================="
echo " 1. Pulling latest code from GitHub..."
echo "=========================================="
git pull origin main

echo "=========================================="
echo " 2. Ensuring database schema (google_id)..."
echo "=========================================="
docker compose exec -T postgres psql -U doctor_connect -d doctor_connect -c "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255); CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id); ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;"

echo "=========================================="
echo " 3. Building and starting updated API and worker..."
echo "=========================================="
docker compose up -d --build server worker

echo "=========================================="
echo " 4. Checking database connection..."
echo "=========================================="
# Never run prisma/seed.js during a deployment. It creates demo admin and
# superadmin accounts with published passwords and deliberately refuses to run
# in production unless ALLOW_SEED=true overrides that safeguard.
docker compose exec -T postgres pg_isready -U doctor_connect -d doctor_connect

echo "=========================================="
echo " 5. Rebuilding client with /api proxy..."
echo "=========================================="
docker compose build --no-cache client
docker compose up -d client

echo "=========================================="
echo " 6. Refreshing nginx upstreams..."
echo "=========================================="
docker compose restart nginx

echo "=========================================="
echo " Done! All services updated and running."
echo "=========================================="
