# BookMyDoctor24

Full-stack healthcare platform: a React web client, a Node/Express/PostgreSQL/Redis backend API,
and a Flutter mobile app for all 4 roles (Patient, Doctor, Receptionist, Admin/Superadmin). The
web client and the mobile app both talk to the SAME backend and database — there's no separate
backend for mobile, and no localStorage-only mode anymore (that was an earlier, frontend-only
version of this project; it's been superseded by the real backend below).

## Sub-projects

| Path | Stack | What it is |
|---|---|---|
| `server/server/` | Node.js + Express + PostgreSQL (Prisma) + Redis | The backend API. Owns auth, all business logic, and the database. |
| `client/` | React 19 + Vite + React Router + Zustand + Tailwind + Chart.js | The web frontend. |
| `mobile/` | Flutter (Dio, Provider, flutter_secure_storage) | The mobile app, mirroring the web client's features. |

## Running it in dev

The backend has to be up first — both the web client and the mobile app are pure API consumers.

**1. Backend** (`server/server/`) — needs PostgreSQL 14+ and Redis 6+ reachable. Full first-time
setup (env vars, database migration, the manual SQL step Prisma's schema language can't express,
seeding demo accounts) is documented in [`server/server/README.md`](server/server/README.md); the
full list of environment variables and what each one does is in
[`server/server/.env.example`](server/server/.env.example). Once set up:

```bash
cd server/server
npm run dev      # HTTP API, reload on file change — listens on PORT (default 4000)
npm run worker   # separate process, run alongside npm run dev: the BullMQ booking-queue worker
```

Both processes are required for booking to work end-to-end — see
[`server/server/src/jobs/worker.process.js`](server/server/src/jobs/worker.process.js)'s header
comment for why the worker has to be its own process. `Dockerfile`, `docker-compose.yml` (repo
root), and `Procfile` are also available if you'd rather run the stack in containers than
install Postgres/Redis locally — see the comments at the top of each for what they do and don't
cover.

**2. Web client** (`client/`):

```bash
cd client
npm install
npm run dev
```

Runs at `http://localhost:5173`. Point it at the backend by setting `VITE_API_BASE_URL` (read in
`client/src/lib/apiClient.js`) to your backend's URL, e.g. `http://localhost:4000`.

**3. Mobile app** (`mobile/`) — needs the Flutter SDK. See
[`mobile/README.md`](mobile/README.md) for setup, demo accounts, and — importantly — how to
point the app at your backend from an emulator vs. a real device on Wi-Fi, since "localhost"
means something different in each case.

```bash
cd mobile
flutter pub get
flutter run
```

## Demo accounts

Both the web client and the mobile app share the same 5 seeded demo accounts (one per role, plus
a superadmin) — see `server/server/README.md`'s seeding step, or either sub-project's README for
the actual credentials.
