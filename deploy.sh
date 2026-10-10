#!/bin/bash
set -e

echo "=========================================="
echo " 1. Pulling latest code from GitHub..."
echo "=========================================="
git pull origin main

echo "=========================================="
echo " 2. Running database migrations..."
echo "=========================================="
docker compose exec -T server npx prisma migrate deploy

echo "=========================================="
echo " 3. Seeding demo accounts & data..."
echo "=========================================="
docker compose exec -T -e ALLOW_SEED=true server npm run seed

echo "=========================================="
echo " 4. Rebuilding client with /api proxy..."
echo "=========================================="
docker compose build --no-cache client
docker compose up -d client

echo "=========================================="
echo " 5. Restarting backend & nginx services..."
echo "=========================================="
docker compose restart server nginx

echo "=========================================="
echo " Done! All services updated and running."
echo "=========================================="
