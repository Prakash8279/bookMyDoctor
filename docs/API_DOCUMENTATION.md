# BookMyDoctor24 — REST API Specification & Reference

This document serves as the complete, authoritative REST API reference for **BookMyDoctor24**. All endpoints, authentication rules, request payloads, response envelopes, query parameters, and error codes are detailed below.

---

## 🌐 Global API Conventions

### Base URL
- **Local Development:** `http://localhost:4000`
- **Docker Compose:** `http://localhost:4000`
- **Production API:** `https://api.bookmydoctor.com` (served via Nginx reverse proxy)

### Interactive Swagger UI
In non-production environments (`NODE_ENV !== 'production'`), interactive documentation is available at:
`http://localhost:4000/api-docs`

---

## 📦 Request & Response Envelopes

Every API response follows a unified JSON envelope structure:

### 1. Success (Single Item / Mutation)
```json
{
  "success": true,
  "data": { ... },
  "message": "Resource created successfully" // Optional
}
```

### 2. Success (Paginated Collection)
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 48,
    "totalPages": 3
  }
}
```

### 3. Failure (Standard Error Envelope)
```json
{
  "success": false,
  "error": {
    "code": "SLOT_ALREADY_BOOKED",
    "message": "This consultation slot has already been booked by another patient.",
    "details": [
      { "field": "slotTime", "message": "Slot is unavailable" }
    ]
  }
}
```

### Standard HTTP Status Codes
| Status Code | Description | Scenario |
|---|---|---|
| `200 OK` | Request succeeded | Successful GET, PATCH, or PUT |
| `201 Created` | Resource created | Successful registration, booking, or payment |
| `204 No Content` | Succeeded with empty body | Successful DELETE or CORS preflight |
| `400 Bad Request` | Malformed request | Syntax errors or invalid parameters |
| `401 Unauthorized` | Missing / Invalid Token | Missing Bearer token or token expired |
| `403 Forbidden` | Insufficient Permissions | Role not authorized or IDOR mismatch |
| `404 Not Found` | Resource not found | Invalid UUID or entity does not exist |
| `409 Conflict` | State conflict | Email already registered or double-booking |
| `422 Unprocessable`| Validation error | Request body failed Joi/custom schema validation |
| `429 Too Many Requests`| Rate limit reached | Exceeded window limits |
| `503 Service Busy`| Server overloaded | Concurrency ceiling reached (in-flight bcrypt) |

---

## 🔑 Common Headers
```http
Authorization: Bearer <accessToken>
Content-Type: application/json
X-Client-Platform: web | mobile
X-Request-Id: 550e8400-e29b-41d4-a716-446655440000
```

---

## 1. 🏥 Health & Liveness Module (`/health`)

### `GET /health`
- **Auth:** None (Public / Infrastructure)
- **Description:** Readiness probe checking Node process, PostgreSQL connectivity, and Redis ping. Returns `503` if any dependency fails.
```bash
curl -X GET http://localhost:4000/health
```
**Response (200 OK):**
```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "uptime": 1284.52
}
```

### `GET /health/live`
- **Auth:** None (Public / Infrastructure)
- **Description:** Shallow liveness probe for container orchestrators (K8s/Docker). Always returns `200 OK` if the Node process is running.
```json
{ "status": "ok", "uptime": 1284.52 }
```

---

## 2. 🔐 Authentication Module (`/auth`)

### `POST /auth/register/email-otp`
- **Auth:** Public | **Rate Limit:** 10 requests / 15 min
- **Description:** Sends a 6-digit verification code to the provided email address (valid for 5 minutes in Redis).
```json
// Request Body
{
  "email": "patient.rahul@example.com"
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "message": "Verification code dispatched to your email."
}
```

### `POST /auth/register`
- **Auth:** Public | **Rate Limit:** 10 / 15 min + In-Flight Guard
- **Description:** Self-registers a new **Patient** account. Requires valid `emailOtp`.
```json
// Request Body
{
  "name": "Rahul Verma",
  "email": "patient.rahul@example.com",
  "password": "Password@123",
  "phone": "9876543210",
  "city": "Bengaluru",
  "emailOtp": "491823"
}
```
**Response (201 Created):**
```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "user": {
      "id": "e89b21a3-cf6a-4d4a-a43b-7f1234567890",
      "name": "Rahul Verma",
      "email": "patient.rahul@example.com",
      "role": "patient",
      "phone": "9876543210",
      "city": "Bengaluru",
      "photoUrl": null,
      "status": "active"
    },
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi..."
  }
}
```

### `POST /auth/login`
- **Auth:** Public | **Rate Limit:** 10 / 15 min + In-Flight Guard
- **Description:** Authenticates via email and password. Protected by constant-time dummy bcrypt comparison.
```json
// Request Body
{
  "email": "patient.rahul@example.com",
  "password": "Password@123"
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "e89b21a3-cf6a-4d4a-a43b-7f1234567890",
      "name": "Rahul Verma",
      "email": "patient.rahul@example.com",
      "role": "patient",
      "status": "active"
    },
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi..."
  }
}
```

### `POST /auth/google`
- **Auth:** Public | **Rate Limit:** 10 / 15 min
- **Description:** "Continue with Google". Validates Google Identity Services OpenID token server-side.
```json
// Request Body
{
  "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEy..."
}
```

### `POST /auth/refresh`
- **Auth:** Public (Takes token via Cookie or JSON Body) | **Rate Limit:** 30 / 15 min
- **Description:** Rotates single-use refresh token. Issues a new access token and new refresh token. Replay attempts trigger session revocation.
```json
// Request Body (Mobile clients pass in body; web passes via httpOnly cookie)
{
  "refreshToken": "eyJhbGciOi..."
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOi...",
    "refreshToken": "eyJhbGciOi..."
  }
}
```

### `POST /auth/logout`
- **Auth:** Authenticated (`Bearer <accessToken>`)
- **Description:** Revokes caller's active refresh token in database and clears the refresh cookie.
```json
{ "success": true, "message": "Logged out successfully" }
```

### `GET /auth/me`
- **Auth:** Authenticated (`Bearer <accessToken>`)
- **Description:** Lightweight token verification endpoint returning current user identity.

### `POST /auth/forgot-password`
- **Auth:** Public | **Body:** `{ "email": "user@example.com" }`

### `POST /auth/reset-password`
- **Auth:** Public | **Body:** `{ "email": "user@example.com", "otp": "123456", "newPassword": "NewPassword@123" }`

---

## 3. 👤 User Self-Management (`/me`)

### `GET /me`
- **Auth:** Any Authenticated User
- **Description:** Returns the caller's complete profile, joining `PatientProfile`, `DoctorProfile`, or `ReceptionistProfile`.

### `PATCH /me`
- **Auth:** Any Authenticated User
- **Description:** Updates the caller's editable profile fields.
```json
// Request Body
{
  "name": "Rahul Verma",
  "phone": "9876543211",
  "city": "Bengaluru",
  "dateOfBirth": "1992-05-14",
  "gender": "male",
  "bloodGroup": "O+",
  "emergencyContact": "9876500000"
}
```

### `PATCH /me/password`
- **Auth:** Any Authenticated User | **Rate Limit:** 5 / 15 min (Keyed to User ID)
```json
// Request Body
{
  "currentPassword": "OldPassword@123",
  "newPassword": "NewPassword@456"
}
```

---

## 4. 📁 Media & Uploads Module (`/media` & `/uploads`)

### `POST /media/photo`
- **Auth:** Any Authenticated User | **Rate Limit:** 20 / 15 min | `multipart/form-data`
- **Form Field:** `file` (JPEG, PNG, WebP — Max 5MB)
- **Description:** Uploads profile avatar; updates user `photoUrl`.

### `POST /media/document`
- **Auth:** `doctor` | **Rate Limit:** 20 / 15 min | `multipart/form-data`
- **Form Field:** `file` (PDF, JPEG, PNG — Max 10MB)
- **Description:** Uploads medical registration / KYC document to private document store.

### `POST /media/qr`
- **Auth:** `doctor`, `receptionist` | `multipart/form-data`
- **Form Fields:** `file` (Image), `clinicId` (UUID)
- **Description:** Uploads clinic payment UPI QR code.

### `GET /uploads/documents/:filename`
- **Auth:** Query Token (`?token=<hmac_file_token>`)
- **Description:** Authenticated serving of private doctor KYC documents. Enforces PDF download.

---

## 5. 🗺️ Geography & Reference Directory (`/geography`)

### `GET /geography/states`
- **Auth:** Public | **Cache:** 60s
- **Returns:** Distinct list of states with clinic coverage.

### `GET /geography/cities?state=Karnataka`
- **Auth:** Public | **Cache:** 60s
- **Returns:** List of cities within selected state.

### `GET /geography/specializations`
- **Auth:** Public | **Cache:** 60s
- **Returns:** Active medical specializations (Cardiology, Dermatology, Pediatrics, etc.).

---

## 6. 🩺 Doctors Module (`/doctors`)

### `GET /doctors`
- **Auth:** Public / Optional Authenticated | **Cache:** 60s
- **Query Parameters:**
  - `page` (default 1), `pageSize` (default 20)
  - `search` (Trigram fuzzy search on doctor name, bio, qualification)
  - `specializationId` (UUID)
  - `city` (string)
  - `status` (Admin only: `active`, `pending_verification`, `rejected`)
  - `emergencyOnly` (boolean: `true` for emergency consultations)
**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "7c12f450-514e-4e4f-b3a1-1234567890ab",
      "doctorNumber": "DCD1001",
      "name": "Dr. Aditi Sharma",
      "specialization": "Cardiology",
      "experienceYears": 12,
      "consultationFee": 800,
      "emergencyFee": 1500,
      "rating": 4.9,
      "reviewCount": 42,
      "clinics": [
        {
          "id": "c1a2b3c4-0000-4000-8000-000000000001",
          "name": "City Health Clinic",
          "city": "Bengaluru",
          "address": "12th Main, Indiranagar"
        }
      ]
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

### `POST /doctors/register`
- **Auth:** Public | **Rate Limit:** 10 / 15 min
- **Description:** Self-registration for doctors. Created in `pending_verification` state.

### `GET /doctors/:id`
- **Auth:** Public / Optional Authenticated
- **Returns:** Detailed profile, OPD hours per clinic, reviews summary, and bank details (bank details visible only to owning doctor or superadmin).

### `PATCH /doctors/:id`
- **Auth:** `doctor` (Own ID), `admin`, `superadmin`
- **Description:** Updates consultation fees, bio, online booking toggles, emergency availability, or payout credentials.

### `PATCH /doctors/:id/status`
- **Auth:** `admin`, `superadmin`
- **Description:** Approves or rejects doctor verification lifecycle (`active`, `rejected`).

### `PATCH /doctors/:id/account-status`
- **Auth:** `admin`, `superadmin`
- **Description:** Enables or disables user login (`active`, `disabled`).

---

## 7. 🏥 Clinics Module (`/clinics`)

### `GET /clinics`
- **Auth:** Public | **Query:** `city`, `search`, `page`, `pageSize`

### `POST /clinics`
- **Auth:** `doctor`, `admin`, `superadmin`
- **Description:** Creates a new clinic. Auto-approved if created by admin; queued for review if created by doctor.

### `PATCH /clinics/:id/approve` & `PATCH /clinics/:id/reject`
- **Auth:** `admin`, `superadmin`

### `POST /clinics/:id/doctors`
- **Auth:** `doctor` (Self), `admin`, `superadmin`
- **Description:** Associates a doctor with a clinic (`doctor_clinics`).

### `PUT /clinics/:clinicId/hours`
- **Auth:** `doctor`, `admin`, `superadmin`
- **Description:** Updates weekly recurring OPD consultation schedule.
```json
// Request Body
{
  "doctorId": "7c12f450-514e-4e4f-b3a1-1234567890ab",
  "hours": [
    { "dayOfWeek": 1, "startTime": "09:00", "endTime": "13:00", "maxTokens": 20 },
    { "dayOfWeek": 1, "startTime": "17:00", "endTime": "20:00", "maxTokens": 15 },
    { "dayOfWeek": 3, "startTime": "09:00", "endTime": "13:00", "maxTokens": 20 }
  ]
}
```

### `POST /clinics/:clinicId/closures`
- **Auth:** `doctor`, `admin`, `superadmin`
- **Description:** Marks a date range where OPD is closed (e.g. doctor on leave / clinic holiday).

---

## 8. 📅 Appointments & Booking Engine (`/appointments`)

### `POST /appointments`
- **Auth:** `patient`, `receptionist` | **Rate Limit:** 20 / 1 min
- **Description:** **Waiting-Room Enqueue.** Queues booking job into BullMQ backed by Redis. Returns a `jobId` for immediate polling.
```json
// Request Body
{
  "doctorId": "7c12f450-514e-4e4f-b3a1-1234567890ab",
  "clinicId": "c1a2b3c4-0000-4000-8000-000000000001",
  "appointmentDate": "2026-10-20",
  "slotTime": "10:30",
  "type": "online", // 'online' | 'walk_in' | 'emergency'
  "familyMemberId": null, // Optional UUID if booking for family
  "reason": "Routine cardiac checkup"
}
```
**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Booking request queued in waiting room.",
  "data": {
    "jobId": "booking-job-98214"
  }
}
```

### `GET /appointments/booking-status/:jobId`
- **Auth:** `patient`, `receptionist`, `admin`, `superadmin`
- **Description:** Polls BullMQ worker progress.
**Response (When Finalized - 200 OK):**
```json
{
  "success": true,
  "data": {
    "status": "completed",
    "appointment": {
      "id": "a901b234-1111-2222-3333-444455556666",
      "appointmentNumber": "B261020-0012",
      "tokenNumber": 7,
      "status": "confirmed",
      "consultationFee": 800,
      "paymentStatus": "pending",
      "appointmentDate": "2026-10-20",
      "slotTime": "10:30"
    }
  }
}
```

### `GET /appointments`
- **Auth:** All Roles (Filtered to Caller Scope)
- **Query:** `status`, `doctorId`, `clinicId`, `date`, `page`, `pageSize`

### `PATCH /appointments/:id/status`
- **Auth:** All Roles (With State Transition Rules)
- **Allowed Transitions:**
  - `patient`: Can change `confirmed` -> `cancelled`
  - `doctor`: Can change to `in_consultation`, `completed`, `no_show`
  - `receptionist`: Can change to `checked_in`, `cancelled`, `no_show`
  - `admin`: Any transition
```json
// Request Body
{
  "status": "cancelled",
  "cancellationReason": "Patient unwell and rescheduling"
}
```

---

## 9. ⏱️ Live OPD Queue Tracker (`/queue`)

### `GET /queue`
- **Auth:** `doctor`, `receptionist` | **Cache:** 10s
- **Query:** `clinicId` (required), `date` (default today), `doctorId` (optional)
- **Returns:** Live list of waiting, called, and active patient tokens.

### `GET /queue/mine/:appointmentId`
- **Auth:** `patient` (Own Appointment Only)
- **Returns:** Patient's live token position, current token being served by doctor, and estimated wait time.
```json
{
  "success": true,
  "data": {
    "myTokenNumber": 14,
    "currentTokenNumber": 9,
    "tokensAhead": 5,
    "estimatedWaitMinutes": 35,
    "doctorStatus": "in_consultation",
    "clinicName": "City Health Clinic"
  }
}
```

### `PATCH /queue/:id/status`
- **Auth:** `doctor`, `receptionist`
- **Status Enum:** `waiting` -> `called` -> `in_consultation` -> `completed` -> `skipped`

---

## 10. 💳 Payments & Reconciliation (`/payments`)

### `POST /payments`
- **Auth:** `receptionist`, `admin`, `superadmin` | **Rate Limit:** 20 / 1 min
- **Description:** Records an on-premise payment (Cash, Clinic POS Card, or Direct Clinic UPI).
```json
// Request Body
{
  "appointmentId": "a901b234-1111-2222-3333-444455556666",
  "amount": 800,
  "method": "cash", // 'cash' | 'upi' | 'card'
  "notes": "Collected at front desk counter 1"
}
```
**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "p1234567-0000-1111-2222-333344445555",
    "receiptNumber": "REC-202610-0089",
    "amount": 800,
    "status": "completed",
    "createdAt": "2026-10-20T10:15:00Z"
  }
}
```

### `POST /payments/razorpay/order`
- **Auth:** `patient` (Own Booking) | **Rate Limit:** 20 / 1 min
- **Description:** Initializes an online Razorpay order for advance appointment payment.
```json
// Request Body
{
  "appointmentId": "a901b234-1111-2222-3333-444455556666"
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "orderId": "order_PK89Xyz123",
    "amount": 80000, // In paise (INR 800.00)
    "currency": "INR",
    "keyId": "rzp_test_YourKeyHere"
  }
}
```

### `POST /payments/razorpay/verify`
- **Auth:** `patient` | **Rate Limit:** 20 / 1 min
- **Description:** Verifies client checkout signature and transitions appointment to paid.
```json
// Request Body
{
  "appointmentId": "a901b234-1111-2222-3333-444455556666",
  "razorpayOrderId": "order_PK89Xyz123",
  "razorpayPaymentId": "pay_PK89Abc456",
  "razorpaySignature": "9a2f7c..."
}
```

### `POST /payments/webhook/razorpay`
- **Auth:** Signature-based (`X-Razorpay-Signature` HMAC check)
- **Description:** Server-to-server webhook from Razorpay for automated reconciliation of unconfirmed payments.

---

## 11. 📋 Medical Records / EMR (`/medical-records`)

### `POST /medical-records`
- **Auth:** `doctor` (Attending Doctor Only)
- **Description:** Creates clinical consultation record, diagnosis, prescriptions, and follow-up advice.
```json
// Request Body
{
  "appointmentId": "a901b234-1111-2222-3333-444455556666",
  "diagnosis": "Mild Essential Hypertension",
  "symptoms": "Occasional headaches, BP 145/95",
  "prescription": [
    { "medicine": "Telmisartan", "dosage": "40mg", "frequency": "1-0-0", "duration": "30 days" }
  ],
  "labTestsRecommended": ["Lipid Profile", "Serum Creatinine"],
  "followUpDate": "2026-11-20"
}
```

### `GET /medical-records`
- **Auth:** `doctor`, `patient`, `admin`, `superadmin` (*Receptionists strictly excluded*)
- **Returns:** Scoped clinical history for the patient.

---

## 12. ⭐ Reviews & Ratings (`/reviews`)

### `GET /reviews?doctorId=<uuid>`
- **Auth:** Public | **Returns:** Approved patient reviews and doctor ratings.

### `POST /reviews`
- **Auth:** `patient` (Must have a completed appointment with that doctor)
```json
// Request Body
{
  "appointmentId": "a901b234-1111-2222-3333-444455556666",
  "rating": 5,
  "comment": "Doctor explained the treatment very clearly. Highly recommend!"
}
```

### `PATCH /reviews/:id/status`
- **Auth:** `admin`, `superadmin`
- **Body:** `{ "status": "approved" | "rejected" }`

---

## 13. 🔔 Notifications (`/notifications`)

### `GET /notifications`
- **Auth:** Any Authenticated User | **Returns:** User's personal in-app notifications.

### `PATCH /notifications/:id/read`
- **Auth:** Any Authenticated User | **Description:** Marks notification as read.

### `POST /notifications/broadcast`
- **Auth:** `admin`, `superadmin`
- **Description:** Broadcasts a platform announcement to all users or specific roles.

---

## 14. 🛠️ Admin & System Operations (`/admin`)

*All routes under `/admin` enforce `adminIpAllowlist` (if configured) + `authenticate` + `authorize('admin', 'superadmin')`.*

### `GET /admin/dashboard-stats`
- **Returns:** Aggregate metrics: active doctors, clinics, patients, appointments today, revenue, pending approvals.

### `GET /admin/activity-log`
- **Query:** `page`, `pageSize`, `action`, `startDate`, `endDate`
- **Returns:** Immutable audit trail of system configuration changes.

### `GET /admin/system-settings` & `PUT /admin/system-settings`
- **Description:** Platform maintenance mode, contact info, support email, cancellation refund policy settings.

### `GET /admin/booking-rules` & `PUT /admin/booking-rules`
- **Description:** Global max advance booking days, cancellation window thresholds, emergency booking fee caps.

### `GET /admin/patients`
- **Description:** Patient directory with search and status filters.

### `PATCH /admin/patients/:id/status`
- **Body:** `{ "status": "active" | "disabled" }`
- **Description:** Disables abusive patient accounts.

---

## 🚨 API Error Codes Reference

| Error Code | HTTP Status | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid Bearer access token |
| `INVALID_REFRESH_TOKEN` | 401 | Refresh token expired, revoked, or invalid |
| `REFRESH_TOKEN_REUSED` | 401 | **Security alert:** Token reuse detected; all sessions revoked |
| `INVALID_CREDENTIALS` | 401 | Incorrect email or password (anti-enumeration constant timing) |
| `FORBIDDEN` | 403 | Role lacks required authorization for this resource |
| `ACCOUNT_DISABLED` | 403 | Account has been suspended by an administrator |
| `NOT_FOUND` | 404 | Target entity does not exist or caller lacks ownership |
| `SLOT_ALREADY_BOOKED` | 409 | Requested slot was reserved by another user |
| `EMAIL_ALREADY_EXISTS` | 409 | Account registration collision with existing email |
| `VALIDATION_ERROR` | 422 | Payload failed schema validation rules |
| `TOO_MANY_REQUESTS` | 429 | Rate limit threshold exceeded |
| `SERVICE_BUSY` | 503 | In-flight concurrency capacity reached; retry requested |
| `INTERNAL_ERROR` | 500 | Unhandled server exception (logged with Request ID) |
