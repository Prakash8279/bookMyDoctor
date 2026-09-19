# Doctor Connect — backend API image.
#
# Multi-stage build: the `deps` stage installs ONLY production dependencies (no devDependencies
# like nodemon/prisma-cli-only-needed-at-dev-time bloat), and the final stage copies just the
# built node_modules + source + prisma schema into a fresh, small base image. This keeps the
# shipped image free of npm's build cache, devDependencies, and anything else `npm install`
# leaves lying around.
#
# `npx prisma generate` runs at IMAGE BUILD time (not container start) so the generated Prisma
# Client is baked into the image — the container never needs network access to Prisma's engine
# download mirror at runtime, and boot time doesn't pay the codegen cost on every restart.
# Schema MIGRATIONS are a separate, deliberate step (`npx prisma migrate deploy`) run against the
# target database — intentionally NOT done automatically here, since auto-migrating on container
# start is unsafe for a multi-replica deployment (every replica would race to run migrations
# concurrently) and for prod rollouts in general (you want migrations reviewed/run explicitly,
# not silently triggered by a scaling event or crash-restart).
#
# This same image is used for both the `web` (HTTP API) and `worker` (BullMQ booking queue
# consumer) processes — see Procfile and docker-compose.yml — by overriding the CMD/command per
# service. The two MUST run as separate processes/containers in production; see
# src/jobs/worker.process.js's header comment for why.

# ---- deps stage: install production dependencies only -----------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- final stage: small runtime image -----------------------------------------------------------
FROM node:20-alpine AS final
WORKDIR /app

# Run as a non-root user rather than the image's default root — limits blast radius if the
# process is ever compromised (can't write outside its own files, can't bind to <1024 anyway
# since PORT defaults to 4000). node:alpine images ship a pre-created `node` user/group for this.
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY prisma ./prisma

# Generates the Prisma Client into node_modules/.prisma/client using the schema above. Needs the
# `prisma` CLI, which is a devDependency — `npx` fetches it on demand via npm's package runner
# rather than requiring it to be a production dependency just for this one build-time step.
RUN npx --yes prisma@5 generate --schema=./prisma/schema.prisma

# uploads/ is where multer writes local-disk file uploads in dev (see .env.example's
# UPLOAD_DIR) — create it up front and hand ownership to the non-root user so a fresh container
# can write to it immediately. In a real production deployment this should be a mounted volume
# (or swapped for S3-compatible storage) rather than the container's own writable layer, since
# anything written to an unmounted path is lost when the container is replaced.
RUN mkdir -p ./uploads && chown -R node:node /app

USER node

EXPOSE 4000

CMD ["node", "src/server.js"]
