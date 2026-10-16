# BookMyDoctor24 (BookADoctors)

[![Node.js](https://img.shields.io/badge/Node.js-18+-68a063.svg?logo=node.js&logoColor=white)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-dc382d.svg?logo=redis&logoColor=white)](https://redis.io/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?logo=react&logoColor=black)](https://react.dev/)
[![Flutter](https://img.shields.io/badge/Flutter-3.3+-02569b.svg?logo=flutter&logoColor=white)](https://flutter.dev/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ed.svg?logo=docker&logoColor=white)](https://www.docker.com/)

**BookMyDoctor24** is an enterprise-grade, multi-tenant healthcare consultation platform, clinic Outpatient Department (OPD) queue management system, and Electronic Medical Record (EMR) portal.

The platform provides a **React 19 Web Single Page Application**, a **Flutter Cross-Platform Mobile Application** (Android & iOS), and an asynchronous **Node.js/Express API Engine** powered by **PostgreSQL (Prisma ORM)**, **Redis (BullMQ)**, and **Nginx**. Both the web client and mobile application communicate with the exact same authenticated REST API.

---

## 📚 Complete Technical Documentation Suite

The complete engineering, security, API, and DevOps specifications are available in the [`docs/`](./docs/README.md) directory:

| Documentation Guide | Focus Area & Description | Link |
|---|---|:---:|
| 📖 **Master Documentation Portal** | High-level system architecture, interactive sitemap, and directory map | [Read Portal](./docs/README.md) |
| 🔒 **Security & Compliance Architecture** | JWT dual-token rotation, AES-256-GCM encryption, OWASP Top 10, rate limiting, and webhooks | [Read Security Spec](./docs/SECURITY_ARCHITECTURE.md) |
| 📡 **REST API Specification** | Complete catalog of 20 modules, 80+ endpoints, request/response schemas, and cURL examples | [Read API Spec](./docs/API_DOCUMENTATION.md) |
| ⚙️ **Backend Engineering Architecture** | Express lifecycle, Prisma ORM, BullMQ queue worker, Redis cache-aside, and locks | [Read Backend Spec](./docs/BACKEND_ARCHITECTURE.md) |
| 💻 **Web Frontend Architecture** | React 19, Vite, Zustand stores, silent refresh Axios interceptors, responsive UI | [Read Frontend Spec](./docs/FRONTEND_ARCHITECTURE.md) |
| 📱 **Mobile App Architecture** | Flutter, Dio interceptors, hardware secure storage, Razorpay mobile SDK, offline banner | [Read Mobile Spec](./docs/MOBILE_APP_ARCHITECTURE.md) |
| 🗄️ **Database & Storage Architecture** | PostgreSQL schema, ERD, triggers, partial unique indexes, trigram search, Redis keyspace | [Read Database Spec](./docs/DATABASE_AND_STORAGE.md) |
| 🚀 **Deployment & DevOps Guide** | Docker Compose multi-replica scaling, Nginx load balancer, environment variables reference | [Read DevOps Spec](./docs/DEPLOYMENT_AND_DEVOPS.md) |
| 🧪 **Testing Strategy & QA Guide** | Jest unit tests, Vitest web tests, Flutter widget tests, Playwright E2E, and k6 load tests | [Read QA Spec](./docs/TESTING_AND_QA.md) |

---

## 🏛️ Sub-Projects & Technology Stack

| Component | Path | Tech Stack | Responsibility |
|---|---|---|---|
| **Backend API & Workers** | `server/server/` | Node.js 18+, Express, PostgreSQL 16 (Prisma), Redis 7 (BullMQ) | Owns business logic, authentication, transactions, queuing, and data storage. |
| **Web Single Page App** | `client/` | React 19, Vite, React Router, Zustand, Tailwind CSS, Chart.js | Responsive web portal for patients, clinic staff, doctors, and administrators. |
| **Mobile Application** | `mobile/` | Flutter (Dart), Dio, Provider, Flutter Secure Storage, Razorpay SDK | Cross-platform native application mirroring 100% of the web client's capabilities. |
| **Reverse Proxy & Gateway**| `nginx/` | Nginx Alpine, Docker | Upstream load balancer routing traffic across multiple API container replicas. |

---

## 👥 Supported User Roles

The platform provides dedicated, role-tailored experiences for all 5 roles:
1. **Patient:** Search doctors by specialization/city, book OPD consultation slots, track live OPD queue position, make online advance payments via Razorpay, and access clinical prescriptions.
2. **Doctor:** Set weekly OPD clinic hours, manage appointment statuses, call waiting tokens into consultation, record diagnoses & prescriptions (EMR), and configure payout details.
3. **Receptionist:** Manage physical front-desk queues, register walk-in patients, issue clinic tokens, collect cash/POS payments, and print receipts.
4. **Admin:** Review and approve doctor verification KYC documents and clinic registrations, manage patient accounts, and view platform activity logs.
5. **Superadmin:** Global platform governance, consultation fee overrides, system-wide settings, and financial reconciliation reports.

---

## ⚡ Quick Start Guide (Local Development)

### Prerequisites
- **Node.js** 18+ & **npm** 9+
- **PostgreSQL** 14+ (or running via Docker)
- **Redis** 6+ (or running via Docker)
- **Flutter SDK** 3.19+ (Optional, only required if running the mobile app)

---

### Step 1: Start the Backend & Worker (`server/server/`)
The backend requires both the **HTTP API** and the **BullMQ Queue Worker** running simultaneously:

```bash
cd server/server
npm install
cp .env.example .env
# Configure DATABASE_URL, REDIS_URL, and generate JWT secrets in .env

# Apply database migrations & seed demo accounts
npx prisma migrate deploy
npm run seed

# Terminal 1: Start the HTTP API Server (Listens on port 4000)
npm run dev

# Terminal 2: Start the Background Queue Worker (Required for appointment booking)
npm run worker
```

---

### Step 2: Start the Web Client (`client/`)
```bash
cd client
npm install
npm run dev
# The web app runs at http://localhost:5173 and connects to http://localhost:4000
```

---

### Step 3: Run the Mobile Application (`mobile/`)
```bash
cd mobile
flutter pub get
flutter run
# Select Android emulator, iOS simulator, or connected device
# Note: For Android Emulator, the app connects to the backend via 10.0.2.2:4000 automatically.
```

---

### Alternative: Run the Entire Stack via Docker Compose
To run PostgreSQL, Redis, multi-replica API servers, workers, and Nginx with a single command:

```bash
cp server/server/.env.example server/server/.env
# Set strong passwords in .env for POSTGRES_PASSWORD and REDIS_PASSWORD
docker compose up --build
```
- **Web Client:** `http://localhost:5173`
- **Load-Balanced API Gateway:** `http://localhost:4000`
- **Swagger Documentation:** `http://localhost:4000/api-docs`

---

## 🔑 Seeded Demo Accounts

All 5 seeded accounts use the password standard `RoleName@123`:

| Role | Email | Password | Access Scope |
|---|---|---|---|
| **Superadmin** | `superadmin@connectdoctor.test` | `Super#DC2026!Test` | Root system access, platform settings, overrides |
| **Admin** | `admin@connectdoctor.test` | `Admin#DC2026!Test` | Doctor verification, clinic approval, dispute resolution |
| **Doctor** | `doctor@connectdoctor.test` | `Doctor#DC2026!Test` | OPD schedules, live patient calling, EMR writes |
| **Receptionist**| `receptionist@connectdoctor.test`| `Reception#DC2026!Test` | Front-desk queue, walk-in tokens, cash billing |
| **Patient** | `patient@connectdoctor.test` | `Patient#DC2026!Test` | Doctor discovery, booking, live queue, EMR records |

---

## 🧪 Testing Suites

```bash
# Backend unit & integration tests
cd server/server && npm run test

# Web frontend component & integration tests
cd client && npm run test

# Mobile unit & widget tests
cd mobile && flutter test

# End-to-end browser automation tests (Playwright)
npx playwright test
```

---

## 📄 License & Attribution

This project is proprietary and confidential. Developed for **BookMyDoctor24 / BookADoctors**. All rights reserved.
