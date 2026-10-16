# BookMyDoctor24 — Security & Compliance Architecture

This document defines the security architecture, threat model, cryptographic controls, authentication protocols, and compliance safeguards implemented in **BookMyDoctor24**.

---

## 🛡️ Executive Security Summary

The platform handles sensitive healthcare data (Personal Identifiable Information / PII, Electronic Medical Records / EMR, and Doctor Financial Information). The architecture enforces defense-in-depth across all layers:

- **Authentication:** Dual-token model (short-lived JWT access tokens + rotated, single-use, DB-hashed refresh tokens).
- **Session Transport:** `httpOnly`, `SameSite=Lax`, `Secure` cookies for web clients; hardware keystore/keychain backing for mobile clients.
- **Authorization:** Strict server-side RBAC enforced via middleware, backed by IDOR checks in every domain service.
- **Encryption at Rest:** AES-256-GCM envelope encryption for financial PII (doctor bank and UPI payout credentials).
- **File Access Security:** Time-limited, HMAC-signed URL tokens for private doctor KYC verification documents.
- **Brute-Force & DoS Mitigation:** Multi-tiered rate limiters with user-ID prioritization, process-level in-flight concurrency guards for CPU-heavy bcrypt operations, and custom libuv thread pool tuning.
- **Webhook Integrity:** HMAC-SHA256 signature verification using constant-time string comparison (`crypto.timingSafeEqual`).

---

## 1. Authentication & Session Management

### 1.1 Dual-Token Architecture

The system avoids long-lived bearer tokens and implements an automated rotation scheme:

```text
Client                          Express API Server                      Database / Redis
  │                                     │                                      │
  │── 1. POST /auth/login ─────────────>│                                      │
  │   (email + password / googleToken)  │── 2. Verify Credentials / bcrypt ───>│
  │                                     │<── 3. User Record + Hash ────────────│
  │                                     │                                      │
  │                                     │── 4. Hash Refresh Token & Store ────>│ (refresh_tokens table)
  │<── 5. Set-Cookie: refreshToken ─────│                                      │
  │       Response: { accessToken }     │                                      │
  │                                     │                                      │
  │── 6. GET /appointments ────────────>│                                      │
  │   (Header: Bearer <accessToken>)    │── 7. jwt.verify() [Stateless HS256] ─│
  │<── 8. Return 200 OK Data ───────────│                                      │
  │                                     │                                      │
  │── [15 Minutes Later - Token Expired]│                                      │
  │── 9. POST /auth/refresh ───────────>│                                      │
  │   (Sends refreshToken in Cookie)    │── 10. Lookup Token Hash in DB ──────>│
  │                                     │<── 11. Match Confirmed ──────────────│
  │                                     │── 12. Revoke Old Token Hash ────────>│
  │                                     │── 13. Generate & Save New Token ────>│
  │<── 14. New Access + Refresh Token ──│                                      │
```

#### Token Characteristics:
| Attribute | Access Token (`accessToken`) | Refresh Token (`refreshToken`) |
|---|---|---|
| **Format** | Signed JWT (`HS256`) | Cryptographically random hex string / signed JWT |
| **Lifespan** | **15 minutes** (`JWT_ACCESS_EXPIRES_IN=15m`) | **30 days** (`JWT_REFRESH_EXPIRES_IN=30d`) |
| **Storage (Web)** | In-memory Zustand state | `httpOnly`, `Secure` (prod), `SameSite=Lax` Cookie |
| **Storage (Mobile)**| `flutter_secure_storage` (Android Keystore / iOS Keychain) | `flutter_secure_storage` |
| **Revocation** | Short expiry bounds risk window | Instant revocation in PostgreSQL `refresh_tokens` |
| **Rotation** | Minted anew on `/auth/refresh` | Single-use: rotated on every refresh |

### 1.2 Refresh Token Reuse Detection (Theft Mitigation)
If an attacker intercepts an already-rotated refresh token and attempts to replay it:
1. The server detects that the presented token hash has already been marked as revoked or deleted.
2. The server treats this as a **Token Theft Incident**.
3. **Emergency Invalidation:** Every active refresh token belonging to that `user_id` is immediately purged from `refresh_tokens`, terminating all sessions across all devices and forcing re-authentication.

### 1.3 Zero-Downtime Secret Key Rotation
To rotate JWT signing keys without forcing a sudden mass-logout:
1. Set `JWT_ACCESS_SECRET_PREVIOUS` and `JWT_REFRESH_SECRET_PREVIOUS` to the current secrets.
2. Generate new values for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
3. The server signs all new tokens with the primary secret, but will accept and verify tokens signed with the previous secret during the deployment overlap.

### 1.4 Password Security & Anti-Enumeration
- **Hashing:** `bcrypt` with cost factor **12** (`BCRYPT_SALT_ROUNDS=12`).
- **Timing-Safe Dummy Verification:** To prevent user enumeration attacks via response timing differences on `/auth/login`:
  ```javascript
  // When an email is not found, the server executes bcrypt against a precomputed dummy hash:
  const DUMMY_HASH = '$2a$12$e80yqVbU...';
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  ```
- Whether the email exists or not, both codepaths consume ~100–150ms of CPU time, yielding identical 401 error payloads and eliminating timing side-channels.

---

## 2. Resource Protection & Concurrency Hardening

### 2.1 Libuv Thread Pool Tuning
`bcrypt` runs on Node's C++ libuv thread pool (default: 4 threads). Under heavy concurrent authentication requests, 4 threads become an immediate bottleneck (~30 req/s ceiling), causing requests to queue until client timeouts fire.
- **Tuning:** Startup scripts explicitly enforce `UV_THREADPOOL_SIZE=16` across development and production:
  ```json
  "dev": "cross-env UV_THREADPOOL_SIZE=16 nodemon src/server.js"
  ```

### 2.2 In-Flight Concurrency Guard (`inFlightGuard.js`)
To prevent server memory exhaustion and event-loop lag during brute-force login spikes:
- `authInFlightGuard` bounds concurrent bcrypt operations to a configurable ceiling (`AUTH_MAX_INFLIGHT=90`).
- If 90 bcrypt operations are actively executing, incoming `/auth/login` and `/auth/register` requests immediately receive `503 SERVICE_BUSY` with a `Retry-After: 3` header rather than queueing indefinitely.

### 2.3 Tiered Rate Limiting Matrix
Rate limiters utilize Redis as a distributed store (`rate-limiter-flexible` / Redis store pattern) with in-memory fallback:

| Limiter | Scope | Window | Max Hits | Key Strategy | Target Endpoints |
|---|---|---|---|---|---|
| `authLimiter` | Sensitive Auth | 15 min | 10 | Client IP | `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`, `/doctors/register` |
| `refreshLimiter` | Token Refresh | 15 min | 30 | Client IP | `/auth/refresh` |
| `passwordChangeLimiter` | Password Update | 15 min | 5 | User ID (`req.user.id`) | `/me/password` |
| `bookingLimiter` | Booking Mutations | 1 min | 20 | User ID / IP fallback | `POST /appointments` |
| `paymentLimiter` | Financial Actions | 1 min | 20 | User ID / IP fallback | `POST /payments`, `/payments/razorpay/*` |
| `uploadLimiter` | File Uploads | 15 min | 20 | User ID / IP fallback | `POST /media/*` |
| `defaultLimiter` | Global Default | 1 min | 300 | User ID / IP fallback | Mounted globally across all API routes |

> **User-ID Priority:** The `defaultLimiter` and specialized limiters inspect the Authorization Bearer header (`bestEffortUserIdFromRequest`) without querying the database. Authenticated users on shared networks (e.g., hospital or clinic Wi-Fi) do not exhaust each other's rate-limiting budgets.

---

## 3. Authorization & Access Control (RBAC & IDOR)

### 3.1 Defense-in-Depth Middleware Pipeline
1. `authenticate.js`: Decodes JWT, validates signature, ensures user is active in PostgreSQL.
2. `authorize('role1', 'role2')`: Verifies `req.user.role` matches allowed roles for that route.
3. **Service Layer Ownership Validation (Anti-IDOR):** The service layer verifies object ownership against `req.user.id` or clinic assignment before returning or updating any record.

### 3.2 Role Permissions Matrix

| Endpoint Group | Patient | Doctor | Receptionist | Admin | Superadmin |
|---|:---:|:---:|:---:|:---:|:---:|
| **Public Search (Doctors/Clinics)** | Read | Read | Read | Read | Read |
| **Self Profile (`/me`, `/me/password`)** | Own | Own | Own | Own | Own |
| **Create Appointment** | Yes | - | Yes (Walk-in) | - | - |
| **View Appointments** | Own | Own OPD | Own Clinic | All | All |
| **OPD Queue Progression (`PATCH /queue`)** | - | Yes | Yes | - | - |
| **Live Queue Status (`GET /queue/mine`)** | Own | - | - | - | - |
| **Clinical Records / EMR Write** | - | Yes | ❌ Excluded | - | - |
| **Clinical Records / EMR Read** | Own | Treated Patients | ❌ Excluded | Yes | Yes |
| **Collect Payments (`POST /payments`)** | - | - | Assigned Clinic | Yes | Yes |
| **Online Self-Pay (Razorpay Order/Verify)** | Yes | - | - | - | - |
| **Doctor Profile / Schedule Edit** | - | Own | - | Yes | Yes |
| **Doctor KYC Document Review** | - | Own Docs | - | Yes | Yes |
| **Clinic / Doctor Approvals** | - | - | - | Yes | Yes |
| **Platform Charge Settings** | - | - | - | Yes | Yes |
| **Admin Activity Log & System Stats** | - | - | - | Yes | Yes |
| **Account Disablement (Users Status)** | - | - | - | Yes | Yes |

*Note: Receptionists are strictly excluded from EMR Medical Records (`/medical-records`) to protect patient clinical confidentiality.*

### 3.3 Admin IP Allowlist Guard (`adminIpAllowlist.js`)
If `ADMIN_IP_ALLOWLIST` is populated in production (e.g. `203.0.113.10,203.0.113.11`), requests targeting `/admin/*` are validated against `req.ip` before executing any cryptographic JWT parsing or database lookups. Requests from non-whitelisted IPs receive `403 FORBIDDEN`.

---

## 4. Cryptography & Data Protection at Rest

### 4.1 Application-Level Field Encryption (AES-256-GCM)
Doctor payout credentials (`bankAccountHolderName`, `bankAccountNumber`, `bankIfscCode`, `bankName`, `bankUpiId`) contain sensitive financial PII. Rather than storing them as plaintext in PostgreSQL, the backend encrypts them via `services/encryptionService.js`:

```text
Plaintext String ──> AES-256-GCM (Cipher) ──> Formatted Storage String:
                     ├── 32-byte Key          "v1:<hex-iv>:<hex-tag>:<hex-ciphertext>"
                     └── 12-byte Unique IV
```

- **Algorithm:** Authenticated AES-256 in Galois/Counter Mode (GCM).
- **Integrity Tag:** 16-byte authentication tag guarantees detection of ciphertext tampering.
- **Initialization Vector:** A cryptographically random 12-byte IV is generated per write.
- **Key Storage:** Driven by `BANK_DETAILS_ENCRYPTION_KEY` (64 hex characters) stored strictly in environment secrets, never in code or the database.

### 4.2 Secure Private Document Serving (`/uploads/documents/`)
Doctor medical registration certificates and KYC credentials must never be publicly accessible:
1. Files are stored in an unserved private directory (`uploads/documents/`).
2. Express static serving (`/uploads`) only serves public avatars and clinic QR codes.
3. Access to documents requires a short-lived HMAC token generated by the server:
   ```text
   GET /uploads/documents/<uuid>.pdf?token=<hmac_token>
   ```
4. Filenames are restricted via regex (`/^[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/i`), and directory components are stripped via `path.basename()`, preventing path-traversal attacks.
5. All PDF responses enforce `Content-Disposition: attachment` to prevent inline browser PDF-viewer exploits.

---

## 5. Network Security, Headers & Webhooks

### 5.1 Helmet & Security Headers
Configured in `app.js`:
- `Content-Security-Policy`: Standard protections against inline scripts and frames.
- `Cross-Origin-Resource-Policy`: Set to `cross-origin` to allow frontend assets (avatars, QR codes) to load cleanly across ports.
- `Strict-Transport-Security`: Enabled in production environments (`max-age=31536000; includeSubDomains`).
- `X-Content-Type-Options: nosniff`: Prevents MIME-type sniffing.
- `X-Frame-Options: SAMEORIGIN`: Prevents clickjacking.

### 5.2 Strict CORS Configuration
```javascript
const configuredOrigins = buildAllowedOriginSet(env.clientOrigin);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // Mobile apps / server-to-server
    if (isAllowedOrigin(origin, configuredOrigins)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true, // Required for httpOnly refresh cookies
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Platform'],
  exposedHeaders: ['X-Request-Id'],
}));
```
*Note: Wildcard `*` origins are strictly forbidden when `credentials: true` is enabled.*

### 5.3 Reverse Proxy Trust Configuration
`app.set('trust proxy', env.trustProxyHops)` is set to an exact integer (e.g. `1` for Nginx or AWS ALB). Setting this to `true` is avoided because an untrusted client could spoof their own IP by sending fabricated `X-Forwarded-For` headers.

### 5.4 Razorpay Webhook HMAC Verification
To safeguard `POST /payments/webhook/razorpay` from spoofing:
1. Mounted with `express.raw({ type: 'application/json' })` to retain the exact raw request Buffer.
2. The `X-Razorpay-Signature` is verified against `RAZORPAY_WEBHOOK_SECRET` using `crypto.createHmac('sha256', secret)`:
   ```javascript
   const digest = hmac.digest('hex');
   const isMatch = crypto.timingSafeEqual(
     Buffer.from(signature, 'utf8'),
     Buffer.from(digest, 'utf8')
   );
   ```
3. Order metadata (`notes.appointmentId` and `notes.patientUserId`) is extracted strictly from Razorpay's cryptographically verified payload, ignoring client-supplied assertions.

---

## 6. OWASP Top 10 Mitigation Matrix

| OWASP Vulnerability | Architecture Defense in BookMyDoctor24 |
|---|---|
| **A01: Broken Access Control** | Explicit RBAC middleware on all routes + ownership filtering (`patientUserId`, `doctorId`, `clinicId`) in services. |
| **A02: Cryptographic Failures** | AES-256-GCM for bank PII; bcrypt (12 rounds) for passwords; TLS 1.3 in transit; HS256 for JWTs with rotated secrets. |
| **A03: Injection (SQL / Command)** | Prisma ORM uses parameterized queries for all database interactions. No dynamic SQL string concatenation. Filenames sanitized via `path.basename`. |
| **A04: Insecure Design** | Double-booking prevented by PostgreSQL partial unique indices + Redis distributed locks. Rate limits on financial sequences. |
| **A05: Security Misconfiguration** | `NODE_ENV=production` disables stack traces and Swagger UI. Strict CORS origin allowlist. Helmet security headers. |
| **A06: Vulnerable Components** | `bcrypt` pinned to `^6.0.0`; automated audits (`npm audit`); minimal external dependencies. |
| **A07: Identification & Auth Failures** | Short-lived access tokens (15m); single-use refresh token rotation; token theft detection; dummy-hash timing attack prevention. |
| **A08: Software & Data Integrity** | Webhooks validated via HMAC-SHA256 (`timingSafeEqual`); file MIME validation prevents executable uploads. |
| **A09: Security Logging & Monitoring** | Request IDs (`X-Request-Id`) attached to all transactions via `AsyncLocalStorage`. Sentry integration for 5xx exceptions without leaking tokens. |
| **A10: Server-Side Request Forgery** | No user-supplied URLs are fetched by the backend server. All outgoing calls (Razorpay, Google) target hardcoded vendor endpoints. |

---

## 7. Healthcare Data Compliance (HIPAA / DISHA Guidelines)

- **Audit Logging:** Administrative modifications (fee changes, system settings, account suspensions) are logged into the immutable `activity_logs` table with timestamp, admin ID, IP address, and payload delta.
- **Data Minimization:** API responses pass through shaping mappers (`shapeDoctor`, `shapeAppointment`, `shapeUser`) that strip password hashes, internal secrets, and unneeded fields before serialization.
- **EMR Segregation:** Prescriptions and medical histories are accessible only to the attending doctor, the specific patient, and auditing administrators. Front-desk receptionists have zero read/write access.

---

## 8. Production Deployment Security Checklist

- [ ] Ensure `NODE_ENV=production`.
- [ ] Generate 64-character random hex strings for `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`.
- [ ] Set a strong 32-byte key (`openssl rand -hex 32`) for `BANK_DETAILS_ENCRYPTION_KEY`.
- [ ] Run `node scripts/encryptExistingBankDetails.js` if migrating pre-existing unencrypted doctor bank rows.
- [ ] Verify `TRUST_PROXY_HOPS` matches the exact number of reverse proxies in your infrastructure.
- [ ] Configure `RAZORPAY_WEBHOOK_SECRET` in both Razorpay Dashboard and server `.env`.
- [ ] Set `ADMIN_IP_ALLOWLIST` to restrict admin portal access to designated VPN/office IPs.
- [ ] Configure SMTP/SES credentials so OTPs and password resets are sent via authentic email channels rather than console logs.
- [ ] Verify that SSL/TLS certificates (HTTPS) are active and enforce HTTP-to-HTTPS redirection.
