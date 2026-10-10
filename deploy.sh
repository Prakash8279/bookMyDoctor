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
echo " 3. Starting updated services with volumes..."
echo "=========================================="
docker compose up -d server worker

echo "=========================================="
echo " 4. Seeding demo accounts (Superadmin, Doctor...)..."
echo "=========================================="
docker compose exec -T -e ALLOW_SEED=true server npm run seed

echo "=========================================="
echo " 5. Rebuilding client with /api proxy..."
echo "=========================================="
docker compose build --no-cache client
docker compose up -d client

echo "=========================================="
echo " 6. Restarting nginx..."
echo "=========================================="
docker compose restart nginx

echo "=========================================="
echo " Done! All services updated and running."
echo "=========================================="
