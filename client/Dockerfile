# BookMyDoctor24 — web client image.
#
# Multi-stage build: stage 1 builds the static Vite bundle (needs Node + devDependencies),
# stage 2 serves that bundle with nginx (no Node, no source, no node_modules in the final
# image — just the compiled dist/ output and a small web server).
#
# Vite bakes VITE_* env vars into the JS bundle AT BUILD TIME, not at container start — there is
# no "runtime env" for a static SPA. So the API URL is passed as a build ARG, and changing it
# means rebuilding the image (`docker compose build client` or `--build-arg` on a plain
# `docker build`), not just restarting the container. Default matches docker-compose.yml's
# `server` service so `docker compose up --build` works with zero extra config out of the box.

# ---- build stage --------------------------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build-time only — see header comment above. Override with:
#   docker compose build client --build-arg VITE_API_BASE_URL=https://api.example.com
ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ARG VITE_GOOGLE_CLIENT_ID=855429506806-s2rgkfeae3k9j14gjbgcg07sni4lrvgi.apps.googleusercontent.com
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build

# ---- runtime stage -------------------------------------------------------------------------------
FROM nginx:1.27-alpine AS final

# SPA fallback (client-side routing via react-router-dom) + gzip — see nginx.conf for details.
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
