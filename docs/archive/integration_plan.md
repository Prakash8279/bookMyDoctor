# Connect — Mock-to-Real-Backend Integration Plan

This document is the complete, authoritative spec for rewiring the React/Zustand client
(`/tmp/connect/client`) to the real Node/Express/Postgres backend (`/tmp/connect/server`),
replacing the mock-data store. It was produced by reading every route/controller/service/
validation file in all 18 backend modules and every page/component/store file in the client.
**Nothing here is guessed — every field name, path, and status code is taken directly from
source.** Downstream coding agents cannot run/test anything (no npm/network access), so this
document over-specifies deliberately. Do not re-derive anything — if it's not here, treat it as
undocumented and flag it rather than guessing.

A syntax checker is available: `node /tmp/connect/check_jsx.js <file.jsx-or-js>` (TypeScript
transpile-only, syntax-only). Run it on every file you touch before considering it done.

---

## 0. Non-negotiable global facts

1. **Response envelope**, universal across all 18 modules:
   - Success: `{ success: true, data: <payload>, pagination?: {page,pageSize,total,totalPages}, message?: string }`
   - Failure: `{ success: false, error: { code: string, message: string, details?: any } }`
   - List endpoints return `data` = the array of rows directly (NOT `{rows,...}` — the service
     layer's internal `{rows, pagination}` shape is unwrapped by the controller: `data: rows`,
     `pagination` promoted to the top-level envelope key). Single-resource endpoints return
     `data` = the object directly.
2. **Base URL**: `import.meta.env.VITE_API_BASE_URL` (already `http://localhost:4000` in
   `client/.env` and `.env.example`). Routes are mounted at `/` (no `/api` prefix) — see
   `server/src/app.js`: `app.use('/', routes)`. So the full path for e.g. doctors is
   `${VITE_API_BASE_URL}/doctors`, NOT `/api/doctors`.
3. **Auth**: JWT access token (short-lived) in `Authorization: Bearer <accessToken>`, plus a
   refresh token used only against `POST /auth/refresh`. `authenticate` middleware rejects
   (401) when missing/invalid/expired; `optionalAuthenticate` never rejects, just conditionally
   sets `req.user` when a valid token is present — used on genuinely public-but-role-aware
   endpoints (doctor directory, clinics, reviews, clinic hours/closures).
4. **Enumeration-avoidance posture**: a caller who is not the owner/scoped-party of a resource
   gets **404**, never 403, on GET/PATCH/DELETE of that specific resource. Don't build UI logic
   that branches on 403 for ownership — it will not happen; a 404 on e.g.
   `GET /appointments/:id` for someone else's appointment means "not found," full stop.
5. **Pagination** query params, wherever supported: `page` (1-based), `pageSize` (max 100).
   Response `pagination: {page, pageSize, total, totalPages}`.
6. **Money fields** come back as decimal-string-like JSON numbers via Prisma Decimal
   serialization — treat as numbers for display (`Number(x).toFixed(2)` when formatting), don't
   assume they're already `number` typed in all cases; safest is `Number(value ?? 0)`.
7. **Dates**: `YYYY-MM-DD` for date-only fields (`appointmentDate`, `dateOfBirth`,
   `followUpDate`, `closedDate` in query/body; `closedDate` in response is a full ISO datetime —
   see clinics section), full ISO 8601 datetime strings for timestamps (`createdAt`, etc.).
8. **IDs are UUIDs** (Postgres). Every `:id`-shaped param must be a real UUID string.

---

## 1. Endpoint Catalog

Format per endpoint: `METHOD /full/path` — auth — roles — body/query fields — response shape/notes.

### 1.1 `/auth` (auth.routes.js, mount prefix `/auth`)

- **`POST /auth/register`** — public (rate-limited via `authLimiter`) — no auth.
  Body: `{name, email, password, phone?, city?, role?}`. `role`, if present, MUST be the literal
  string `"patient"` — anything else fails validation (422). The service layer ALSO hard-codes
  `role:'patient'` server-side regardless. **There is no way for a client to self-register as a
  doctor.** Response `data`: `{ user: {id,name,email,role,phone,city,photoUrl,status,createdAt}, accessToken, refreshToken }`.
- **`POST /auth/login`** — public (rate-limited) — no auth.
  Body: `{email, password}`. Response `data`: `{ user: {id,name,email,role,phone,city,photoUrl,status}, accessToken, refreshToken }`
  (note: `createdAt` is present on register's user but OMITTED on login's user — a real,
  deliberate asymmetry in the source). This user object has NO profile subfields (no
  dateOfBirth/qualification/etc.) — call `GET /me` right after login to get the full profile.
  401 `INVALID_CREDENTIALS` on bad email/password. 403 `ACCOUNT_DISABLED` if the account is
  disabled (checked only after password verification).
- **`POST /auth/logout`** — requires `authenticate`. Body: `{refreshToken}` (required — the
  client must send back the refresh token it holds, not just rely on the access token).
  Idempotent, no error on already-revoked token. `data`: none meaningful (probably `null`/`{}`—
  treat as fire-and-forget).
- **`POST /auth/refresh`** — public (NOT behind `authenticate` — the whole point). Body:
  `{refreshToken}`. Response `data`: `{accessToken, refreshToken}` (new refresh token —
  ROTATION: the old refresh token is now invalid, always persist the new one). On reuse of an
  already-rotated/revoked refresh token, the backend detects replay and revokes ALL of that
  user's sessions — the client will get a 401 and must force full logout/re-login, no retry.
- **`GET /auth/me`** — requires `authenticate`. No body/query. Response `data`:
  `{id,name,email,role,phone,city,photoUrl,status,createdAt}` (base columns only, no profile —
  this is a cheap identity check, distinct from the richer `GET /me` in the `me` module).

### 1.2 `/me` (me.routes.js, mount prefix `/me`) — every route requires `authenticate`, self only

- **`GET /me`** — Response `data`: `{id,name,email,phone,city,photoUrl,role,status,createdAt,
  profile}` where `profile` is a **nested object** (NOT spread onto the top level):
  - patient: `{dateOfBirth,gender,bloodGroup,emergencyContact,address,medicalHistory,about}`
    (all patientProfile columns except `userId`), or `null` if no profile row.
  - doctor: all doctorProfile columns except `userId`/`specializationId`, PLUS a nested
    `specialization: {id, name}` object (via the include). Includes `status` (verification
    lifecycle: pending/verified/disabled), `verificationDocuments`, `rating`, `reviewCount`,
    `onlineBooking`, `allowRebooking`, `maxDaysAdvance`, `consultationFee`, `emergencyFee`,
    `qualification`, `registrationNumber`, `experienceYears`, `languages`, `bio`,
    `emergencyAvailable`.
  - receptionist: all receptionistProfile columns except `userId` (includes `clinicId`,
    `since`).
  - admin/superadmin: `profile: null`.
- **`PATCH /me`** — Body (all optional; only recognized+role-allowed fields are persisted, others
  silently ignored):
  - base (every role): `name, phone, city, photoUrl`. `photoUrl` MUST be a valid `http(s)://` URL
    (`isURL` validator) — a `data:` base64 URI FAILS validation. **There is no file-upload
    endpoint anywhere in the API** (only a static `/uploads` GET mount exists, no POST). The
    mock's `FileReader.readAsDataURL` photo-picker pattern cannot be wired to this endpoint.
  - patient-only: `dateOfBirth, gender, bloodGroup, emergencyContact, address, medicalHistory, about`.
  - doctor-only: `specializationId, qualification, registrationNumber, experienceYears,
    consultationFee, emergencyFee, languages (array of strings), bio, emergencyAvailable`.
    Notably ABSENT (not editable via `/me` for a doctor): `onlineBooking, allowRebooking,
    maxDaysAdvance` (those are `PATCH /doctors/:id` only), and `status`/`verificationDocuments`/
    `rating`/`reviewCount` (admin/system-owned).
  - receptionist/admin/superadmin: no profile-editable fields at all.
  Response `data`: same shape as `GET /me` (full refreshed profile).
- **`PATCH /me/password`** — rate-limited (`passwordChangeLimiter`, keyed per-user). Body:
  `{currentPassword, newPassword, confirmPassword}` — **all three required**, `confirmPassword`
  must match `newPassword` (422 otherwise). 400 `INVALID_CURRENT_PASSWORD` if wrong. 400
  `SAME_PASSWORD` if new === current. **On success, ALL of that user's refresh tokens are
  revoked** (`tokenService.revokeAllForUser`) — the current session's own refresh token is
  invalidated too, so the client must treat a successful password change as "log the user out,
  force re-login," not as a silent success that keeps the session alive.

### 1.3 `/geography` (geography.routes.js, mount prefix `/geography`)

- **`GET /geography/cities`** — public. Query: `search?, page?, pageSize?`. `data`: array of
  `{id, name, state}`.
- **`GET /geography/areas`** — public. Query: `cityId?, search?, page?, pageSize?`. `data`:
  array of `{id, name, pincode, cityId}`. **Areas are NEVER nested under a city object** — this
  is a flat top-level resource, always fetched separately and filtered by `cityId` query param
  when needed. (Mock's `city.areas` nesting does not exist in the real API.)
- **`GET /geography/specializations`** — public. Query: `search?, page?, pageSize?`. `data`:
  array of `{id, name, icon, description}`.
- **`POST /geography/cities`** — admin/superadmin. Body: `{name, state?}`.
- **`POST /geography/cities/:cityId/areas`** — admin/superadmin. Body: `{name, pincode?}`
  (6-digit string).
- **`POST /geography/specializations`** — admin/superadmin. Body: `{name, icon?, description?}`.
- No PATCH/DELETE on any geography resource this phase.

### 1.4 `/doctors` (doctors.routes.js, mount prefix `/doctors`)

- **`GET /doctors`** — `optionalAuthenticate`. Query: `specializationId?, cityId?, areaId?,
  minRating?, search?, emergencyAvailable?, sortBy? (rating|fee|experience), sortOrder?
  (asc|desc), page?, pageSize?`. **Always hard-filtered server-side to
  `role:'doctor', status:'active', doctorProfile.status:'verified'` — no admin bypass exists on
  this route at all.** `data`: array of doctor directory items:
  ```
  {
    id, name, photoUrl, city,
    specialization: {id, name, icon} | null,
    qualification, registrationNumber, experienceYears,
    consultationFee, emergencyFee, languages: string[],
    rating, reviewCount, emergencyAvailable, onlineBooking,
    clinics: [{id, name, city: string|null, area: string|null}, ...]
  }
  ```
  `clinics` is a real array (a doctor can be linked to multiple clinics), each entry filtered to
  `approvalStatus:'active'` clinics only. `cityId`/`areaId` filters match via the doctor's
  **linked active clinics**, not a direct doctor-city field (`user.city` is display-only).
  **GAP**: there is no query param or admin bypass anywhere that returns pending/disabled
  doctors — the admin "doctor verification queue" UI has no backing list endpoint. See §6.1.
- **`GET /doctors/:id`** — `optionalAuthenticate`. Same shape as list item PLUS
  `bio, allowRebooking, maxDaysAdvance`. If the doctor isn't verified+active, only the doctor
  themself or an admin/superadmin can see it (else 404).
- **`PATCH /doctors/:id`** — doctor(self)/admin/superadmin. Body (ALL THREE fields required,
  full-replace of just these 3, NOT a partial patch of the whole profile):
  `{onlineBooking: bool, allowRebooking: bool, maxDaysAdvance: int 1-365}`.
  **This endpoint ONLY updates these 3 booking-policy fields.** Everything else about a doctor's
  own profile (bio, fee, languages, qualification, etc.) goes through `PATCH /me` instead. A
  single "edit doctor profile" UI form must submit to BOTH endpoints.
- **`POST /doctors`** — admin/superadmin only (this is how a doctor account is actually created).
  Body: `{name, email, password, phone?, city?, specializationId (UUID, required),
  qualification?, registrationNumber?, experienceYears?, consultationFee (required),
  emergencyFee?, languages?: string[], bio?, verificationDocuments?: [{name,url}] (url must be
  http(s)), verifyImmediately?: bool}`. `specializationId` MUST be a real UUID from
  `GET /geography/specializations` — no free-text specialization name accepted.
- **`PATCH /doctors/:id/status`** — admin/superadmin. Body: `{status: 'pending'|'verified'|'disabled'}`.
  This is the doctor-verification-lifecycle field (`doctorProfile.status`), DISTINCT from the
  user account's own `status` (active/disabled) — there is no endpoint in the doctors module to
  disable the underlying USER account of a doctor (that's a receptionists-module-style gap; not
  found anywhere in the 18 modules for a doctor's account-level status).

### 1.5 `/clinics` (clinics.routes.js, mount prefix `/clinics`)

- **`POST /clinics`** — doctor/admin/superadmin. Body: `{name, phone?, address?, cityId
  (required), areaId?, emergencyAvailable?, paymentCashEnabled?, paymentUpiEnabled?,
  paymentUpiId?, paymentQrUrl? (http(s) URL)}`. Newly created clinics presumably start
  `approvalStatus:'pending'` (see approve/reject below).
- **`GET /clinics`** — `optionalAuthenticate`. Query: `city? (cityId UUID), area? (areaId UUID),
  search?, emergencyAvailable?, approvalStatus? ('pending'|'active'|'disabled'), mine? (bool),
  page?, pageSize?`. `data`: array of
  `{id, name, phone, address, approvalStatus, emergencyAvailable, paymentCashEnabled,
  paymentUpiEnabled, createdAt, city: {id,name}, area: {id,name}}`. `approvalStatus` filter and
  `mine` (clinics the caller doctor is assigned to) are available to any caller but a non-owner/
  non-admin will only ever see `approvalStatus:'active'` rows regardless of what they request
  (server-enforced visibility). **Admin CAN filter by `approvalStatus=pending` here** — this is
  the "pending clinics queue," unlike doctors (§1.4 gap).
- **`GET /clinics/:id`** — `optionalAuthenticate`. `data`: full detail shape:
  `{id, name, phone, address, approvalStatus, rejectionReason, emergencyAvailable,
  paymentCashEnabled, paymentUpiEnabled, paymentUpiId, paymentQrUrl, createdAt, updatedAt,
  city: {id,name,state}, area: {id,name,pincode},
  doctors: [{doctorUserId, name, photoUrl, isOwner, isPrimary, onlineBooking}, ...]}`.
  Non-active clinic visible only to an assigned doctor or admin (else 404).
- **`PATCH /clinics/:id`** — doctor(must be `isOwner:true` assignee)/admin/superadmin. Body (all
  optional, full field set): `{name, phone, address, cityId, areaId, emergencyAvailable,
  paymentCashEnabled, paymentUpiEnabled, paymentUpiId, paymentQrUrl}`. A doctor who is assigned
  but NOT `isOwner` gets 403.
- **`PATCH /clinics/:id/approve`** — admin/superadmin. No body. Sets `approvalStatus:'active'`.
- **`PATCH /clinics/:id/reject`** — admin/superadmin. Body: `{rejectionReason (5-1000 chars,
  required)}`. Sets `approvalStatus:'disabled'` (note: "reject" and "disable" are the SAME
  status value/action in this schema — there's no separate disable-an-active-clinic endpoint,
  `reject` is reused for that too).
- **`POST /clinics/:id/doctors`** — doctor(owner of `:id`)/admin/superadmin. Body:
  `{doctorUserId (required), isOwner?, isPrimary?, onlineBooking?}` (booleans default
  false/false/true respectively when omitted). Target doctor must be `role:'doctor'` and
  `doctorProfile.status:'verified'` (else 400/404).
- **`PATCH /clinics/:id/doctors/:doctorUserId`** — same auth. Body:
  `{isOwner?, isPrimary?, onlineBooking?}` (booleans; explicit `null` on any of these 3 is
  rejected as 422 since they're NOT NULL columns).
- **`DELETE /clinics/:id/doctors/:doctorUserId`** — same auth. Unassigns the doctor.
- **`PUT /clinics/:clinicId/hours`** — doctor(assigned there)/admin/superadmin. **Upsert by
  `(doctorUserId, clinicId, weekday)`** — calling again with the same trio overwrites, doesn't
  duplicate. Body: `{doctorUserId? (required if actor is admin; ignored/forced-to-self if actor
  is doctor), weekday (0=Sun..6=Sat, required), startTime (HH:MM, required), endTime (HH:MM,
  required, must be > startTime), slotMinutes? (default 15), status? ('active'|'inactive',
  default 'active')}`. Response `data`: `{id, doctorUserId, clinicId, weekday, startTime,
  endTime, slotMinutes, status}`. **This is the real destination for the mock's weekly-OPD-type
  "opdEntries."**
- **`GET /clinics/:clinicId/hours`** — `optionalAuthenticate`. Query: `doctorId?, page?, pageSize?`.
  `data`: array of the same hours shape.
- **`DELETE /clinics/:clinicId/hours/:hoursId`** — doctor(own row)/admin/superadmin.
- **`POST /clinics/:clinicId/closures`** — doctor(assigned there)/admin/superadmin.
  **Upsert-like by `(doctorUserId, clinicId, closedDate)`** (implemented as findFirst-then-
  create/update, not a true unique-constraint upsert — a narrow race window exists but is not
  the frontend's concern). Body: `{doctorUserId? (required if admin), closedDate (ISO8601 date,
  required), reason? (max 500 chars)}`. Response `data`: `{id, doctorUserId, clinicId,
  closedDate, reason}`. **This is the real destination for the mock's closing-date-type
  "opdEntries."**
- **`GET /clinics/:clinicId/closures`** — `optionalAuthenticate`. Query: `doctorId?, from?, to?
  (ISO8601 dates), page?, pageSize?`.
- **`DELETE /clinics/:clinicId/closures/:closureId`** — doctor(own row)/admin/superadmin.

**Mapping note**: the mock's single `opdEntries` array (with a type discriminator) must be
split client-side into "weekly recurring" entries → hours endpoints, and "one-off closed date"
entries → closures endpoints, on save/delete, keyed by the REAL server-issued `id` from each
resource (not a locally generated id).

### 1.6 `/family-members` (familyMembers.routes.js, mount prefix `/family-members`) — every route: `authenticate` + `authorize('patient')`, hard-scoped server-side to `req.user.id` (body/params `patientUserId` is NEVER read — this is the literal fix for the mock's cross-patient family-member leak)

- **`GET /family-members`** — Query: `page?, pageSize?`. `data`: array of
  `{id, name, relation, dateOfBirth, gender, bloodGroup, age}`. `age` is computed fresh on every
  read from `dateOfBirth` (never stale, unlike the mock's client-side `calculateAge` cached at
  save time).
- **`GET /family-members/:id`** — same shape, single object.
- **`POST /family-members`** — Body: `{name (required), relation (required, free text),
  dateOfBirth? (ISO date, not in future), gender?, bloodGroup?}`.
- **`PATCH /family-members/:id`** — Body: same fields, all optional (name/relation reject
  explicit null).
- **`DELETE /family-members/:id`**.

### 1.7 `/receptionists` (receptionists.routes.js, mount prefix `/receptionists`) — every route: `authenticate` + `authorize('doctor','admin','superadmin')`

- **`POST /receptionists`** — Body: `{name, email, password (8-72 chars), phone?,
  clinicId (required, UUID)}`. **`clinicId` is mandatory and explicit** — this is the literal
  fix for the mock's "auto-assigned to clinics[0] platform-wide" bug. Creates a real login
  account (receptionist role). Response `data`: `{id, name, email, phone, status, createdAt,
  clinicId, clinicName, since}`.
- **`GET /receptionists`** — Query: `clinicId?, page?, pageSize?`. Same row shape, array.
- **`GET /receptionists/:id`** — same shape, single.
- **`PATCH /receptionists/:id`** — Body: `{name?, phone?, clinicId?}` (name/clinicId reject
  explicit null — a receptionist can be reassigned to another clinic but never unassigned).
- **`PATCH /receptionists/:id/status`** — Body: `{status: 'active'|'disabled'}`.
- No DELETE (soft-disable-only pattern, consistent with the rest of the schema).

**Convergence note**: the mock currently has TWO inconsistent receptionist-creation call sites
(a display-only one in AdminPages.jsx and a login-fields one in FeaturePages.jsx). Both must
converge on this single real endpoint — the admin-side form needs new required email/password
fields added.

### 1.8 `/appointments` (appointments.routes.js, mount prefix `/appointments`) — **the most architecturally important module: booking is fully asynchronous.**

- **`POST /appointments`** — `authenticate` + `authorize('patient','receptionist')` +
  `bookingLimiter` (rate-limited). Body: `{doctorUserId (required, UUID), clinicId? (UUID),
  appointmentDate (YYYY-MM-DD, required), appointmentTime (HH:MM 24h, required), reason?
  (max 1000 chars), isEmergency? (bool), familyMemberId? (UUID, patient callers only —
  silently dropped for a receptionist caller), patientUserId? (UUID, REQUIRED when the caller
  is a receptionist booking on behalf of someone; ignored/forced-to-self for a patient caller),
  paymentMethod? ('cash'|'upi'|'card'|'online')}`.
  **Returns HTTP 202, not 200**, with `data: {jobId, status:'queued'}` — the real booking logic
  (slot-availability checks, fee computation, queue-token creation, etc.) runs asynchronously in
  a background worker. The client MUST poll for the result — see next endpoint. Do NOT treat
  this response as "booking succeeded."
- **`GET /appointments/booking-status/:jobId`** — `authenticate`, roles
  `patient,receptionist,admin,superadmin`. `data.status` is one of:
  - `'queued'` or `'processing'` — still working; keep polling.
  - `'confirmed'` — `data: {jobId, status:'confirmed', appointment: <full shaped appointment,
    see below>}`. Booking succeeded.
  - `'failed'` — `data: {jobId, status:'failed', error: <error info object>}`. Booking failed
    (e.g. slot taken); surface `error` to the user, do not retry automatically.
  Recommended client polling: short interval (e.g. 1.5–2s), reasonable timeout (e.g. 30–45s)
  after which show a "still processing, check My Appointments shortly" message rather than
  hanging forever.
- **`GET /appointments`** — `authenticate`, all roles. Query: `status?
  ('upcoming'|'confirmed'|'completed'|'cancelled'|'no_show'), date?, dateFrom?, dateTo?
  (YYYY-MM-DD), doctorId?, clinicId?, patientId?, page?, pageSize?`. Server-side scoping (not
  client-controlled): patient sees only their own; doctor sees only their own; receptionist sees
  only their clinic's; admin/superadmin see everything (query filters narrow further within that
  scope).
- **`GET /appointments/:id`** — single, same visibility rule as list (404 if not visible).
- **`PATCH /appointments/:id/status`** — Body: `{status: 'confirmed'|'completed'|'cancelled'|'no_show'}`
  (`'upcoming'` is never a valid target — it's create-only default). **Role-gated targets**:
  patient may ONLY set `'cancelled'` on their own appointment (and only within the
  `booking_rules.cancellationWindowHours` window — bypassed for staff/admin); doctor/
  receptionist/admin/superadmin may set any of the 4. **State-machine gated**: from
  `'upcoming'` → any of the 4 is legal; from `'confirmed'` → `completed|cancelled|no_show`; from
  `completed|cancelled|no_show` → nothing (terminal, 409 `APPOINTMENT_INVALID_TRANSITION`-style
  error on attempt).

**Response shape** (every appointment read returns this, via `shapeAppointment`):
```
{
  id,
  patient: {id, name} | null,
  familyMember: {id, name, relation} | null,
  doctor: {id, name, photoUrl, specialization: {id, name} | null} | null,
  clinic: {id, name} | null,
  appointmentDate (YYYY-MM-DD), appointmentTime, reason, isEmergency,
  status, source ('online'|'walk_in'), tokenNumber,
  paymentStatus, paymentMethod,
  fees: <role-masked, see below>,
  notes, checkedInAt, createdAt, updatedAt
}
```
**Fee masking (`fees` sub-object) — CRITICAL, applies identically in `/payments` too:**
- doctor/receptionist: `{ consultationFee }` ONLY — every other money field OMITTED entirely
  (not null, not zero — the key is simply absent from the object).
- patient (their own): `{ consultationFee, convenienceFee, emergencyFee, gstAmount, totalAmount }`
  — no commission/clinicPayout.
- admin/superadmin: `{ consultationFee, convenienceFee, emergencyFee, gstAmount, totalAmount,
  commission, clinicPayout }` — `commission`/`clinicPayout` are computed on read (not stored),
  and are `null` if the platform-charges commissionPercent couldn't be loaded for some reason.

**Any page code currently reading a flat `appointment.totalAmount` / `.paidAmount` /
`.consultationFee` must switch to optional-chained `appointment.fees?.consultationFee` etc., and
must render "—" or hide the row for a field absent under the current role's masking, not assume
it's always present.**

### 1.9 `/queue` (queue.routes.js, mount prefix `/queue`) — `authenticate` + `authorize('doctor','receptionist')` (no admin override)

- **`GET /queue`** — Query: `date? (YYYY-MM-DD, default today), status?
  ('waiting'|'called'|'in_consultation'|'completed'), page?, pageSize?`. Doctor sees only their
  own queue tokens; receptionist sees only their clinic's (empty list if the receptionist has no
  `clinicId` assignment). `data`: array of:
  ```
  { id, appointmentId, tokenNumber, status, patientsAhead, estimatedWaitMinutes,
    patient: {id, name} | null, source }
  ```
  `patientsAhead`/`estimatedWaitMinutes` are ALWAYS computed against the true full waiting queue
  for that (doctor, date), regardless of the `status` filter applied to the page — i.e. filtering
  to `status=called` still shows correct ETAs, not ETAs computed only within the filtered subset.
  `estimatedWaitMinutes = patientsAhead * 9` (server constant, deliberately replicated, not a
  "fix", from the old mock heuristic).
- **`PATCH /queue/:id/status`** — Body: `{status: 'called'|'in_consultation'|'completed'}`
  (**note: real enum uses `in_consultation` with an UNDERSCORE**, not the mock's `'in
  consultation'` with a space — fix this literal string at the call site). **Strictly
  sequential, forward-only**: `waiting→called→in_consultation→completed` only, one step at a
  time — skipping or going backward is a 409 `QUEUE_INVALID_TRANSITION`. Completing a token
  cascades server-side to also set the linked appointment's `status:'completed'` (unless already
  terminal) — the client does NOT need to separately call the appointments status endpoint for
  this case. Response `data`: `{id, appointmentId, tokenNumber, status, queueDate}`.

### 1.10 `/prescriptions` (prescriptions.routes.js, mount prefix `/prescriptions`) — receptionist explicitly excluded from read access (clinical data)

- **`POST /prescriptions`** — doctor only. Body: `{appointmentId? (UUID), patientUserId?
  (UUID — required if appointmentId absent; derived from appointment and any client-sent value
  ignored if appointmentId present), diagnosis (required, max 2000), clinicalNotes? (max 4000),
  recommendedTests? (max 2000), advice? (max 2000), followUpDate? (YYYY-MM-DD, no
  future-only constraint), medicines?: [{name (required), dosage?, frequency?, duration?,
  instructions?}, ...] (max 50)}`. **This properly persists dosage/frequency/duration/
  instructions per medicine** — a genuine fix over the mock's `addPrescription`, which only ever
  saved bare medicine name strings and silently dropped everything else.
- **`GET /prescriptions`** — doctor/patient/admin/superadmin. Query: `page?, pageSize?,
  patientId?, doctorId?, appointmentId?`. Scoped server-side to own/treating relationship for
  non-admin.
- **`GET /prescriptions/:id`** — same scoping.

Response shape: `{id, appointment: {id}|null, doctor: {id,name}|null, patient: {id,name}|null,
diagnosis, clinicalNotes, recommendedTests, advice, followUpDate (YYYY-MM-DD),
medicines: [{id, name, dosage, frequency, duration, instructions}, ...], createdAt}`.

### 1.11 `/medical-records` (medicalRecords.routes.js, mount prefix `/medical-records`) — receptionist excluded (clinical data)

- **`POST /medical-records`** — doctor only. Body: `{appointmentId? (UUID), patientUserId?
  (UUID, same resolution rule as prescriptions), title (required, max 300), type? (max 100),
  notes? (max 4000), carePlan? (max 4000)}`. **`notes`/`carePlan` are now actually persisted**
  — the literal fix for the mock's `addRecord`, which only ever saved `{name,type}`.
- **`GET /medical-records`** — doctor/patient/admin/superadmin. Query: `page?, pageSize?,
  patientId?, doctorId?, appointmentId?`.
- **`GET /medical-records/:id`** — same scoping.

Response shape: `{id, appointment:{id}|null, doctor:{id,name}|null, patient:{id,name}|null,
title, type, notes, carePlan, createdAt}`.

### 1.12 `/payments` (payments.routes.js, mount prefix `/payments`)

- **`POST /payments`** — **receptionist/admin/superadmin ONLY — a patient can never create their
  own payment record.** Rate-limited (`paymentLimiter`). Body: `{appointmentId? (UUID),
  patientUserId? (UUID), doctorUserId? (UUID), clinicId? (UUID), isEmergency? (bool),
  mode (required: 'cash'|'upi'|'card'|'online'), transactionRef? (required unless mode==='cash')}`.
  Cross-field rule: if `appointmentId` absent, both `patientUserId` AND `doctorUserId` are
  required (cash-collected-without-a-booking scenario). Response `data`: full shaped payment
  (below), `status` likely `'paid'` on creation, `receiptNumber` auto-generated.
- **`GET /payments`** — all roles, server-scoped (patient: own only; doctor/receptionist:
  their clinic/patients only, masked; admin: all). Query: `page?, pageSize?, status?
  ('pending'|'paid'|'refunded'), mode?, dateFrom?, dateTo?, appointmentId?, patientId?,
  doctorId?, clinicId?`.
- **`GET /payments/:id`** — same scoping (404 if not visible).

Response shape: `{id, receiptNumber, appointment:{id}|null, patient:{id,name}|null,
doctor:{id,name}|null, clinic:{id,name}|null, mode, transactionRef, status, fees: <masked>,
createdAt}`. **`fees` masking is IDENTICAL to appointments' (§1.8)** — same 3-tier
doctor/receptionist-vs-patient-vs-admin logic, same field names
(`consultationFee, convenienceFee, emergencyFee, gstAmount, amount [note: "amount" here, not
"totalAmount" like appointments], commission, clinicPayout`).

**No patient self-pay path exists.** After booking, an appointment sits with
`paymentStatus:'pending'` until a receptionist/admin records a payment. The Patient Payments
page must become read-only (list their own payments); any "Pay Now" UI implying the patient can
complete their own payment must be removed or clearly marked as staff-only/pending.

### 1.13 `/platform-charges` (platformCharges.routes.js, mount prefix `/platform-charges`) — singleton config row

- **`GET /platform-charges`** — any authenticated role. `data` for non-admin:
  `{patientConvenienceFee, emergencyFee, gstPercent, applyConvenienceFee, applyEmergencyFee}`
  (**`commissionPercent` is masked out entirely for every non-admin role**, even though this is
  a "preview" endpoint, not a payment/appointment record). For admin/superadmin, `data` ALSO
  includes `commissionPercent`.
- **`PUT /platform-charges`** — admin/superadmin. Full-replace, ALL 6 fields required every
  call: `{commissionPercent (0-100), patientConvenienceFee (0-99999999.99), emergencyFee
  (0-99999999.99), gstPercent (0-100), applyConvenienceFee (bool), applyEmergencyFee (bool)}`.
  **Field-name/type rename table vs the mock:**

  | Mock field | Mock type | Real field | Real type |
  |---|---|---|---|
  | `commission` | string | `commissionPercent` | float |
  | `patientFee` | string | `patientConvenienceFee` | float |
  | `emergencyFee` | string | `emergencyFee` | float (name same, type changes) |
  | `gst` | string | `gstPercent` | float |
  | `applyPatientFee` | — | `applyConvenienceFee` | bool |
  | `applyEmergencyFee` | — | `applyEmergencyFee` | bool (name same) |

  Response on PUT returns the FULL unmasked row (caller is already admin-gated).

### 1.14 `/reviews` (reviews.routes.js, mount prefix `/reviews`)

- **`GET /reviews`** — `optionalAuthenticate`, public. Query: `doctorId?, status?
  ('pending'|'approved'|'rejected'), page?, pageSize?`. **For anonymous/patient/doctor/
  receptionist callers, `status` is IGNORED and ALWAYS forced to `'approved'` server-side** —
  a patient can NEVER see their own pending/rejected review via this endpoint, even the one they
  personally submitted. Only admin/superadmin get to honor the `status` filter (default: all
  statuses, for the moderation queue). Flag this as a genuine limitation, not something to paper
  over client-side.
- **`POST /reviews`** — patient only. Body: `{appointmentId (required, UUID), rating (required,
  1-5 int), text? (max 2000)}`. Appointment must belong to this patient AND be `status:
  'completed'` (else 404/400). 409 `REVIEW_ALREADY_EXISTS` if already reviewed. **No `status`
  field accepted from the client at all** — always created `pending`, moderation-bypass-proof.
- **`PATCH /reviews/:id/status`** — admin/superadmin. Body: `{status:
  'pending'|'approved'|'rejected'}`. Free movement between all 3 (no state machine).

Response shape: `{id, doctor:{id,name}, patient:{id,name}, rating, text, status, createdAt}`.
**`doctorProfile.rating`/`.reviewCount` are recomputed automatically by a DB trigger** whenever
a review's status changes to/from approved — never write these fields directly from any
frontend code; they only ever come from `GET /doctors`/`GET /doctors/:id`/`GET /me`.

### 1.15 `/notifications` (notifications.routes.js, mount prefix `/notifications`)

- **`POST /notifications/broadcast`** — admin/superadmin. Body: `{audience (required:
  'all'|'patients'|'doctors'|'receptionists'|'single_user'), title (required, max 200), body
  (required, max 2000), type? (max 50, default 'broadcast'), targetUserId? (required+UUID only
  when audience==='single_user')}`. Response `data`: shaped notification PLUS `recipientCount`.
- **`GET /notifications/broadcast`** — admin/superadmin, the broadcast HISTORY/log (distinct
  from personal inbox below). Query: `page?, pageSize?`. `data`: array of
  `{id, title, body, type, audience, targetUserId, createdAt, recipientCount, readCount}`.
- **`GET /notifications`** — all roles, the caller's OWN inbox (hard-scoped to `req.user.id`).
  Query: `unreadOnly? (bool), page?, pageSize?`. `data`: array of
  `{id, notificationId, title, body, type, createdAt, readAt}`. **`id` here is the
  NotificationRecipient row's own id** — this is what `PATCH /:id/read` takes, NOT the
  underlying Notification's id (`notificationId` is a separate field, present for reference but
  not the key to mutate on).
- **`PATCH /notifications/read-all`** — all roles. No body. `data`: `{updatedCount}`.
- **`PATCH /notifications/:id/read`** — all roles, `:id` = NotificationRecipient id (see above).
  Idempotent (already-read is a no-op 200). `data`: `{id, readAt}`.

### 1.16 `/complaints` (complaints.routes.js, mount prefix `/complaints`)

- **`POST /complaints`** — patient only. Body: `{subject (required, max 200), description?
  (max 5000)}`.
- **`GET /complaints`** — patient(own)/admin/superadmin(all). Query: `status?
  ('open'|'in_progress'|'resolved'|'closed'), page?, pageSize?`.
- **`GET /complaints/:id`** — same scoping.
- **`PATCH /complaints/:id`** — admin/superadmin only. Body: `{status?, adminResponse? (max
  5000)}`. **Field is `adminResponse`, NOT `response`** (the mock's `updateComplaint(id,
  {status,response})` call must rename this field).

Response shape: `{id, raisedBy:{id,name}, subject, description, status, adminResponse,
createdAt, updatedAt}`.

### 1.17 `/contact` (contact.routes.js, mount prefix `/contact`)

- **`POST /contact`** — fully public, no auth at all. Body: `{name (required, max 150), email
  (required, valid email), subject (required, max 200), message (required, max 5000)}`.
- **`GET /contact`** — admin/superadmin only. Query: `status? ('open'|'responded'|'resolved'),
  page?, pageSize?`.
- **`PATCH /contact/:id`** — admin/superadmin. Body: `{status?, response? (max 5000)}`.
  **Field is `response` here (matches the mock — no rename needed for contact, unlike
  complaints' `adminResponse`).**

Response shape: `{id, name, email, subject, message, status, response, createdAt}`.

### 1.18 `/admin` (admin.routes.js, mount prefix `/admin`) — every route: `authenticate` + `authorize('admin','superadmin')`

- **`GET /admin/activity-log`** — Query: `actorUserId?, actionType?, page?, pageSize?`. `data`:
  array of `{id, actor:{id,name}|null, actorRole, actionType, targetEntityType, targetEntityId,
  description, createdAt}`. This is a structured replacement for the mock's pre-formatted log
  string — `targetEntityType`/`targetEntityId` are distinct fields, not baked into `description`.
- **`GET /admin/system-settings`** — `data`: `{id, platformName, supportEmail, supportPhone,
  bookingFee, maintenanceMode}` (full row, no masking — admin-only route). **`maintenanceMode`,
  not the mock's `maintenance`.**
- **`PUT /admin/system-settings`** — full-replace, ALL fields required: `{platformName
  (required, max 200), supportEmail? (email), supportPhone? (max 30), bookingFee (required,
  0-99999999.99), maintenanceMode (required, bool)}`.
- **`GET /admin/booking-rules`** — `data`: `{id, cancellationWindowHours, maxBookingsPerPatient,
  defaultSlotMinutes}`.
- **`PUT /admin/booking-rules`** — full-replace, ALL required: `{cancellationWindowHours
  (0-720 int), maxBookingsPerPatient (1-100 int), defaultSlotMinutes (5-120 int)}`. This is a
  currently-unwired mock page/section — wire it to this real endpoint as part of the port
  (`PlatformSettings` or a new admin settings section).
- **`GET /admin/dashboard-stats`** — `data`: `{verifiedDoctorsCount, registeredPatientsCount,
  todaysBookingsCount, monthlyRevenue}`. **These are the real, correct numbers** — replaces the
  mock's buggy client-computed stand-ins (`doctors.length` mislabeled as "verified,"
  `payments.reduce(sum)` mislabeled as "monthly" but actually all-time, and a literal
  `date === 'Today'` string check).

**GAPS explicitly confirmed NOT covered by this module** (per its own header comment) — already
implemented elsewhere or genuinely absent:
- Clinic/doctor approval queues live in `/clinics` and `/doctors` respectively (see §1.4's
  pending-doctors gap — clinics has a working queue via `?approvalStatus=pending`, doctors does
  not have any admin bypass at all).
- Revenue reports beyond `dashboardStats.monthlyRevenue` — no time-series/analytics endpoint
  exists anywhere in the 18 modules. See §6.3.

---

## 2. `apiClient.js` design

New file: `client/src/lib/apiClient.js`. Replaces the dead `lib/api.js` stub (delete or leave
unused — do not import it anywhere). Uses `axios` (already a dependency).

```js
import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

// Keep the raw tokens in module-scope + localStorage (persisted across reloads). Do NOT put
// tokens inside the Zustand `data` object / its persisted blob — keep auth-token storage
// separate from app data so a `persist` partialize/migrate change never accidentally drops or
// exposes tokens differently than intended.
const TOKEN_STORAGE_KEY = 'connect_auth_tokens'; // { accessToken, refreshToken }

function loadTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  try {
    if (tokens) localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch { /* ignore quota/private-mode errors */ }
}

let tokens = loadTokens(); // { accessToken, refreshToken } | null

// Exported so the store can read/clear auth state without importing axios directly.
export function getTokens() { return tokens; }
export function setTokens(next) { tokens = next; saveTokens(next); }
export function clearTokens() { tokens = null; saveTokens(null); }

const apiClient = axios.create({ baseURL: BASE_URL });

apiClient.interceptors.request.use((config) => {
  if (tokens && tokens.accessToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

// One-shot silent refresh-then-retry on 401. `_retry` flag prevents infinite loops. A second
// 401 in a row (including one from the refresh call itself) clears tokens and lets the error
// propagate — the store's onUnauthorized callback (registered below) is called so App-level
// state can redirect to /login.
let onUnauthorized = () => {};
export function registerUnauthorizedHandler(fn) { onUnauthorized = fn; }

let refreshPromise = null; // de-dupe concurrent 401s into a single refresh call

apiClient.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && body.success === false) {
      // Shouldn't normally happen (non-2xx should already reject) but defensive: treat a
      // success:false 2xx the same as a thrown error.
      const err = new Error(body.error?.message || 'Request failed');
      err.code = body.error?.code;
      err.details = body.error?.details;
      throw err;
    }
    // Unwrap the envelope: callers get `data` directly. Pagination, when present, is attached
    // as a non-enumerable-ish convenience property on the returned value so call sites that
    // need it can read `result.__pagination` without it polluting `...spread` usage or
    // `Object.keys` on array results. (Arrays and primitives can still have properties attached
    // in JS.) Document this convention wherever a store action needs pagination.
    const data = body?.data;
    if (body && body.pagination !== undefined) {
      try { Object.defineProperty(data, '__pagination', { value: body.pagination, enumerable: false }); }
      catch { /* primitive data (rare) — skip attaching */ }
    }
    return data;
  },
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const body = error.response?.data;

    if (status === 401 && !original._retry && original.url !== '/auth/refresh') {
      original._retry = true;
      if (!tokens || !tokens.refreshToken) {
        clearTokens();
        onUnauthorized();
        return Promise.reject(shapeError(body, error));
      }
      try {
        if (!refreshPromise) {
          refreshPromise = apiClient
            .post('/auth/refresh', { refreshToken: tokens.refreshToken })
            .finally(() => { refreshPromise = null; });
        }
        const refreshed = await refreshPromise; // already-unwrapped {accessToken, refreshToken}
        setTokens(refreshed);
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${refreshed.accessToken}`;
        return apiClient(original);
      } catch (refreshErr) {
        clearTokens();
        onUnauthorized();
        return Promise.reject(shapeError(refreshErr.response?.data, refreshErr));
      }
    }

    if (status === 401) {
      // Second 401 in a row, or the refresh call itself failed with 401 (reuse-detected /
      // fully invalid) — unrecoverable, clear and bail.
      clearTokens();
      onUnauthorized();
    }

    return Promise.reject(shapeError(body, error));
  }
);

function shapeError(body, originalError) {
  const message = body?.error?.message || originalError.message || 'Request failed';
  const err = new Error(message);
  err.code = body?.error?.code || null;
  err.details = body?.error?.details || null;
  err.status = originalError.response?.status || null;
  return err;
}

export default apiClient;
```

**Usage convention for pagination**: `const rows = await apiClient.get('/doctors', {params});`
then `rows` is the array with `rows.__pagination` available when the endpoint returns one.
Store actions that need pagination for a paginated list UI should destructure it immediately:
`const pagination = rows.__pagination;`.

**Every store action** built on this client should be a plain `async function` that calls
`apiClient.get/post/patch/put/delete(path, {params}|body)`, updates `set(state => ...)`, and
`throw`s on failure so call sites can `try/catch` — do NOT swallow errors inside the store;
let the calling component decide how to surface them (toast/inline message), matching how
`LoadingSkeleton`/`EmptyState` are already used for loading/empty states, not error states — a
new lightweight inline error pattern (e.g. a red text line reusing `FormField`'s error slot, or
a small inline `<div role="alert">`) should be used at call sites, consistent per file.

---

## 3. Store rewrite — `useAppStore.js`

### 3.1 New shape of the store

```js
{
  // ---- auth/session ----
  currentUser: null,        // full GET /me response shape (or auth summary pre-/me-call)
  isAuthenticated: false,
  authLoading: false,       // true during login/register/refresh-on-boot

  // ---- bulk app data ----
  data: { ...DEFAULT_DATA_SHAPE (see §5) },
  dataLoading: false,       // true while the post-login/pre-login bulk load is in flight
  dataLoaded: false,        // becomes true once the initial bulk load completes at least once

  // ---- ~50 action methods, now async, see §4 table ----
}
```

- Drop `demoAccounts`, `cleanPersistedData`, `cleanAccounts`, `rehydrateCurrentUser` entirely —
  these existed only to manage the mock's seeded fake accounts; there's nothing to seed/clean
  against a real backend.
- `persist` middleware: **do NOT persist `data` wholesale anymore.** Persist only
  `{currentUser, isAuthenticated}` (or nothing — tokens already live in `apiClient.js`'s own
  localStorage key, and `data` should be treated as a cache that's always refetched on boot, not
  trusted stale). Recommended `partialize: (state) => ({ currentUser: state.currentUser,
  isAuthenticated: state.isAuthenticated })`. Simplify/remove the old `migrate`/`merge` config —
  there's no legacy mock shape to migrate from once this ships (a one-time
  `localStorage.removeItem` of the old persisted key on boot, guarded by a version bump in the
  `persist` config's `name`/`version`, is a reasonable belt-and-suspenders addition but not
  required).
- On app boot (`main.jsx`/`App.jsx`, see G7 in §6), if `apiClient`'s stored tokens exist, call
  `GET /me` to re-validate + refresh `currentUser` before rendering protected routes; if that
  401s (refresh also failing), clear everything and treat as logged-out.

### 3.2 Action mapping table

Legend for "call-site sync→async" column: **Y** = at least one current call site treats the
return value synchronously and MUST be changed to `await`/`.then`; **N** = no call site does
(action is fire-and-forget or its return value is unused/already awaited-safe); **DEAD** = zero
call sites found via grep — safe to drop or de-prioritize.

| Action | New behavior | Endpoint(s) | Sync→Async |
|---|---|---|---|
| `login(email,password)` | POST /auth/login → setTokens → GET /me → set currentUser | `POST /auth/login`, `GET /me` | Y |
| `register(fields)` | POST /auth/register (role always 'patient' — drop any "register as doctor" UI toggle) → setTokens → GET /me | `POST /auth/register`, `GET /me` | Y |
| `logout()` | POST /auth/logout (best-effort) → clearTokens → reset currentUser/data | `POST /auth/logout` | Y |
| `updateProfile(fields)` | PATCH /me → set currentUser from response | `PATCH /me` | Y |
| `changePassword(current,next,confirm)` | **3-arg now** (was 2) → PATCH /me/password → on success, clear tokens + currentUser (all sessions revoked server-side) and route to login | `PATCH /me/password` | Y |
| `updatePhoto(...)` | **Cannot be wired** — no upload endpoint, `photoUrl` requires an http(s) URL. Keep as local-preview-only no-op, or remove the picker; document inline as a known gap. | none | N/A — GAP |
| `fetchCities/fetchSpecializations/fetchAreas` (new, bulk-load helpers) | GET, populate `data.cities/specializations/areas` | `GET /geography/cities`, `/specializations`, `/areas` | N (bulk-load only) |
| `searchDoctors(filters)` | GET /doctors with query params → replace `data.doctors` (or a separate `data.doctorSearchResults` if pagination/filtering needs to coexist with a full directory cache — recommend the latter to avoid clobbering the bulk-loaded directory) | `GET /doctors` | Y |
| `getDoctor(id)` | GET /doctors/:id | `GET /doctors/:id` | Y |
| `updateDoctorBookingPolicy(id,{onlineBooking,allowRebooking,maxDaysAdvance})` (renamed/split from `updateDoctor`) | PATCH /doctors/:id | `PATCH /doctors/:id` | Y |
| `updateDoctorProfile(fields)` (the other half of the old `updateDoctor` — bio/fee/languages/etc.) | PATCH /me (doctor-editable fields only) | `PATCH /me` | Y |
| `createDoctor(fields)` | POST /doctors — needs `specializationId` (UUID) not free text | `POST /doctors` | Y |
| `updateDoctorStatus(id,status)` | PATCH /doctors/:id/status | `PATCH /doctors/:id/status` | DEAD (0 call sites currently — still port it; admin verification UI needs it once the pending-list gap (§6.1) is addressed or worked around) |
| `addDoctor(...)` (old mock name) | Superseded by `createDoctor` | — | DEAD — drop |
| `fetchClinics(filters)` | GET /clinics | `GET /clinics` | Y |
| `getClinic(id)` | GET /clinics/:id | `GET /clinics/:id` | Y |
| `createClinic(fields)` | POST /clinics | `POST /clinics` | Y |
| `updateClinic(id,fields)` | PATCH /clinics/:id | `PATCH /clinics/:id` | Y |
| `approveClinic(id)` | PATCH /clinics/:id/approve | `PATCH /clinics/:id/approve` | Y |
| `rejectClinic(id,reason)` | PATCH /clinics/:id/reject | `PATCH /clinics/:id/reject` | Y |
| `assignDoctorToClinic(clinicId,fields)` (replaces misuse of `updateDoctor` in DoctorClinics page) | POST /clinics/:id/doctors | `POST /clinics/:id/doctors` | Y |
| `updateDoctorClinicAssignment(clinicId,doctorUserId,fields)` | PATCH /clinics/:id/doctors/:doctorUserId | same | Y |
| `removeDoctorFromClinic(clinicId,doctorUserId)` | DELETE /clinics/:id/doctors/:doctorUserId | same | Y |
| `saveOpdEntry(entry)` (mock) → split into `upsertClinicHours(clinicId,fields)` + `createClinicClosure(clinicId,fields)` | PUT /clinics/:clinicId/hours or POST /clinics/:clinicId/closures, chosen by entry type | both | Y |
| `removeOpdEntry(clinicId,entry)` → split into `deleteClinicHours(clinicId,hoursId)` + `deleteClinicClosure(clinicId,closureId)` | DELETE .../hours/:id or .../closures/:id | both | Y |
| `fetchFamilyMembers()` | GET /family-members | `GET /family-members` | Y |
| `addFamilyMember(fields)` | POST /family-members | `POST /family-members` | Y |
| `updateFamilyMember(id,fields)` | PATCH /family-members/:id | `PATCH /family-members/:id` | Y |
| `removeFamilyMember(id)` | DELETE /family-members/:id | `DELETE /family-members/:id` | Y |
| `fetchReceptionists(filters)` | GET /receptionists | `GET /receptionists` | Y |
| `addReceptionist(fields)` / `createReceptionistAccount(fields)` (mock has 2 — CONVERGE to 1) | POST /receptionists (now requires clinicId+email+password on both call sites) | `POST /receptionists` | Y |
| `updateReceptionist(id,fields)` | PATCH /receptionists/:id | `PATCH /receptionists/:id` | Y |
| `updateReceptionistStatus(id,status)` | PATCH /receptionists/:id/status | `PATCH /receptionists/:id/status` | Y |
| `createAppointment(fields)` | **enqueue+poll**: POST /appointments (202, jobId) → internal poll loop against GET /appointments/booking-status/:jobId until confirmed/failed/timeout → resolve/reject the returned Promise accordingly. Booking page call site (`const appointment = createAppointment(...)`) MUST become `await` and handle the polling delay in UI (spinner/"confirming your booking…"). | `POST /appointments`, `GET /appointments/booking-status/:jobId` | Y (critical) |
| `fetchAppointments(filters)` | GET /appointments | `GET /appointments` | Y |
| `getAppointment(id)` | GET /appointments/:id | `GET /appointments/:id` | Y |
| `updateAppointmentStatus(id,status)` | PATCH /appointments/:id/status (role/state-machine gated server-side — surface the 409 message on illegal transitions rather than hiding buttons perfectly client-side, though hiding obviously-illegal actions is still good UX) | `PATCH /appointments/:id/status` | Y |
| `cancelAppointment(id)` (if separate from status update in mock) | same endpoint, `status:'cancelled'` | `PATCH /appointments/:id/status` | Y |
| `fetchQueue(filters)` | GET /queue | `GET /queue` | Y |
| `setQueueTokenStatus(id,status)` | PATCH /queue/:id/status — **fix `'in consultation'` → `'in_consultation'`** at the StaffPages.jsx call site | `PATCH /queue/:id/status` | Y |
| `queueAction(...)` | Superseded/unclear mock action | — | DEAD — drop |
| `addQueueToken(...)` | Queue tokens are created server-side only (via booking) | — | DEAD — drop |
| `fetchPrescriptions(filters)` | GET /prescriptions | `GET /prescriptions` | Y |
| `addPrescription(fields)` | POST /prescriptions — **now sends full medicine objects (dosage/frequency/duration/instructions), not bare name strings** — update the form-handler to build the new payload shape | `POST /prescriptions` | Y |
| `fetchRecords(filters)` | GET /medical-records | `GET /medical-records` | Y |
| `addRecord(fields)` | POST /medical-records — **now sends `notes`/`carePlan` too, not just `{name,type}`** — rename `name`→`title` at the call site | `POST /medical-records` | Y |
| `fetchPayments(filters)` | GET /payments | `GET /payments` | Y |
| `createPayment(fields)` | POST /payments — **staff/admin only; remove/gate any patient-facing "pay now" call site** | `POST /payments` | Y |
| `fetchPlatformCharges()` | GET /platform-charges | `GET /platform-charges` | Y |
| `updatePlatformCharges(fields)` | PUT /platform-charges — **apply the full rename/retype table in §1.13** at the form-handler | `PUT /platform-charges` | Y |
| `fetchReviews(filters)` | GET /reviews — remember non-admin `status` is ignored server-side | `GET /reviews` | Y |
| `addReview(fields)` | POST /reviews | `POST /reviews` | Y |
| `updateReviewStatus(id,status)` | PATCH /reviews/:id/status | `PATCH /reviews/:id/status` | Y |
| `fetchNotifications(filters)` | GET /notifications | `GET /notifications` | Y |
| `markNotificationRead(id)` | PATCH /notifications/:id/read — **`id` must be the NotificationRecipient id already present on the row from the list fetch, not the underlying notification id** | `PATCH /notifications/:id/read` | Y |
| `markAllNotificationsRead()` | PATCH /notifications/read-all | `PATCH /notifications/read-all` | Y |
| `broadcastNotification(fields)` | POST /notifications/broadcast | `POST /notifications/broadcast` | Y |
| `fetchBroadcastHistory(filters)` (new, admin) | GET /notifications/broadcast | `GET /notifications/broadcast` | Y |
| `fetchComplaints(filters)` | GET /complaints | `GET /complaints` | Y |
| `addComplaint(fields)` | POST /complaints | `POST /complaints` | Y |
| `updateComplaint(id,{status,adminResponse})` | PATCH /complaints/:id — **rename `response`→`adminResponse` at the call site** | `PATCH /complaints/:id` | Y |
| `fetchContactRequests(filters)` | GET /contact | `GET /contact` | Y |
| `submitContactRequest(fields)` | POST /contact — public, no auth | `POST /contact` | Y |
| `updateContactRequest(id,{status,response})` | PATCH /contact/:id (`response` field name unchanged) | `PATCH /contact/:id` | Y |
| `addActivity(...)` (mock; used only by 2 public demo-request forms) | **No real equivalent** (activity log is admin-read-only/auto-populated). Repoint both call sites (HomeExtras.jsx clinic-demo form, PublicLanding.jsx ProviderLanding form) to `submitContactRequest` instead, synthesizing `subject:"Clinic demo request"` (or similar) from the form fields. | `POST /contact` (repointed) | Y |
| `fetchActivityLog(filters)` (new, admin) | GET /admin/activity-log | `GET /admin/activity-log` | Y |
| `fetchSystemSettings()` / `updateSystemSettings(fields)` | GET/PUT /admin/system-settings — **rename `maintenance`→`maintenanceMode`** | both | Y |
| `fetchBookingRules()` / `updateBookingRules(fields)` (new — currently unwired in mock) | GET/PUT /admin/booking-rules | both | Y |
| `fetchDashboardStats()` | GET /admin/dashboard-stats — replaces all client-computed stat derivations in AdminDashboard | `GET /admin/dashboard-stats` | Y |
| `saveDraft(key,val)` / `drafts` | Mostly local-only no-op; keep as-is for anything with no real backend target (DoctorFees, DoctorFollowUps' "Schedule" action — see §6.4 GAP). For PlatformSettings/booking-rules, repoint to the real endpoints above instead of the draft mechanism. | n/a for most; real endpoints for settings/rules | Y (partial) |
| `banPatient(id)` | **No endpoint found anywhere in the 18 modules for disabling a patient account** (receptionists/doctors have status-toggle endpoints; patients don't). DEAD call-site-wise too (0 references). Drop, or flag as a genuine backend gap if product wants it revived. | — | DEAD — drop, flag as gap |
| `updateQueue` (internal helper) | Superseded — queue state now always comes from `GET /queue`, no client-side recomputation needed. Drop. | — | N/A — drop |

**Every "Y" action above is a required behavioral change at its call site(s)**: wrap in
`async function handleX() { try { await storeAction(...); ... } catch (err) { ...show err.message... } }`,
convert any `onClick={() => storeAction(...)}` that assumed a synchronous return into an async
handler, and add a loading-disabled state on the triggering button while the request is in
flight (reuse existing button/loading patterns already in the file — do not invent a new spinner
component).

---

## 4. Bulk-load strategy

Two-phase load, orchestrated from G7 (App shell) so it runs once regardless of which page the
user lands on first.

### 4.1 Pre-login / public phase (runs on every app boot, unauthenticated or not)

Fire in parallel (`Promise.all`), populate `data` directly, set `dataLoading` true until settled:

- `GET /geography/cities` → `data.cities`
- `GET /geography/areas` → `data.areas` (new top-level key — see §5)
- `GET /geography/specializations` → `data.specializations`
- `GET /doctors` (first page, reasonable `pageSize`, e.g. 50–100 — the public directory) →
  `data.doctors`
- `GET /clinics` (first page, `approvalStatus` omitted → server defaults to active-only for a
  non-privileged view) → `data.clinics`
- `GET /reviews` (no `doctorId` filter, first page — approved-only for anon) → `data.reviews`

Do NOT call any `authenticate`-gated endpoint here — a logged-out visitor must be able to browse
the public site fully on this phase alone (matches PublicPages/PublicLanding's existing
no-login-required browsing).

### 4.2 Post-login phase (runs once immediately after `login`/`register` succeed AND on boot-time
session restore when tokens are already present and `GET /me` succeeds)

Call `GET /me` first (always, every role) → sets `currentUser` with full profile. Then, branch
by `currentUser.role`:

- **patient**: `GET /family-members`, `GET /appointments` (own), `GET /prescriptions` (own),
  `GET /medical-records` (own), `GET /payments` (own), `GET /notifications`,
  `GET /reviews?doctorId=` is NOT needed in bulk (fetched per-doctor-page on demand instead).
- **doctor**: `GET /appointments` (own), `GET /queue` (own, today), `GET /prescriptions` (own),
  `GET /medical-records` (own), `GET /payments` (own, masked), `GET /notifications`,
  `GET /receptionists?clinicId=` for clinics they own (fetch after clinic list resolves, or defer
  to the relevant page), `GET /platform-charges` (masked, for fee-preview context if needed).
- **receptionist**: `GET /appointments` (clinic-scoped), `GET /queue` (clinic-scoped, today),
  `GET /payments` (clinic-scoped, masked), `GET /notifications`.
- **admin/superadmin**: `GET /admin/dashboard-stats`, `GET /notifications`,
  `GET /platform-charges` (unmasked), `GET /admin/system-settings`, `GET /admin/booking-rules`.
  Do NOT bulk-load `GET /admin/activity-log`, `GET /complaints`, `GET /contact`,
  `GET /receptionists`, `GET /clinics?approvalStatus=pending` — these are page-specific, fetch
  on that page's mount instead (they're either large/filterable lists or admin-only sub-pages
  not needed app-wide).

Set `dataLoading:false, dataLoaded:true` once this phase's `Promise.all` (or per-role subset)
settles — including on partial failure (log/report which calls failed but don't block the whole
app on one failing fetch; each page can still individually retry/refetch on mount).

### 4.3 Loading splash

G7 owns rendering a full-page loading state (reuse `LoadingSkeleton.jsx`, do not invent a new
spinner) while `dataLoading` is true AND `dataLoaded` is false (i.e., only on the very first
load — subsequent refetches should not blank the whole app, just show per-section loading via
existing patterns already in each page).

---

## 5. Default `data` shape

Every key must be initialized (never `undefined`) so pages can render empty states immediately
via `EmptyState.jsx` before the first fetch resolves, matching current usage.

```js
const DEFAULT_DATA_SHAPE = {
  // Reference/geography
  cities: [],
  areas: [],              // NEW — flat top-level resource, was nested under city in the mock
  specializations: [],

  // Directory
  doctors: [],
  clinics: [],

  // Patient-owned
  familyMembers: [],
  appointments: [],
  prescriptions: [],
  records: [],             // kept as `records` (mapped to the medicalRecords module) to
                            // minimize page-file diff vs renaming to `medicalRecords`
  payments: [],

  // Staff/clinic operations
  queueTokens: [],          // now sourced from GET /queue; structurally different from the
                             // mock shape — see §1.9 for the new per-row fields
  receptionists: [],
  opdEntries: [],            // client-side-only merged view of clinic hours + closures for
                              // display; each item still carries its real server id and a
                              // `kind: 'hours'|'closure'` discriminator so save/delete route to
                              // the correct endpoint pair (see §1.5 mapping note)

  // Reviews / notifications / support
  reviews: [],
  notifications: [],
  broadcasts: [],            // NEW — admin broadcast history (GET /notifications/broadcast)
  complaints: [],
  contactRequests: [],

  // Admin
  activity: [],              // now sourced from GET /admin/activity-log
  dashboardStats: null,      // GET /admin/dashboard-stats result, or null until loaded
  systemSettings: null,      // GET /admin/system-settings result
  bookingRules: null,        // GET /admin/booking-rules result
  platformCharges: null,     // GET /platform-charges result (masked or not, per role)

  // GENUINE GAPS — no real backend equivalent exists; keep the keys (so existing page code
  // referencing them doesn't crash) but they stay permanently empty/null and any UI reading
  // them should be updated to show a clear "not available" state rather than a silently-empty
  // table that looks like "no data yet":
  pendingDoctors: [],        // §6.1 — no admin list endpoint for pending/disabled doctors
  pendingClinics: [],        // NOT actually a gap — derive this from
                              // `GET /clinics?approvalStatus=pending` instead of keeping it as
                              // a separately-fetched key; kept here only if a page literally
                              // reads `data.pendingClinics` and a full-file refactor to read
                              // `data.clinics.filter(...)` isn't in scope for that group.
  analytics: null,           // §6.3 — no time-series endpoint exists anywhere
  checkedIns: [],            // was already effectively always-empty in the mock; no real
                              // backend concept found distinct from appointment.checkedInAt —
                              // if any page reads this, repoint it to derive from
                              // `data.appointments.filter(a => a.checkedInAt)` instead.

  // Removed entirely (no longer meaningful once a real backend exists):
  // - patients (mock's flat "all patients" cache) — no `/patients` module/endpoint exists in
  //   the 18 modules at all; any page reading `data.patients` needs its own investigation (see
  //   the per-group notes in §6 for any page that references this) since there's no direct
  //   fetch to replace it with. Likely candidates: derive a patients list from
  //   `GET /appointments` distinct patients (imperfect) or flag as an additional gap.
};
```

Plus, at the top level of the store (siblings of `data`, not inside it):
```js
currentUser: null,
isAuthenticated: false,
authLoading: false,
dataLoading: false,
dataLoaded: false,
```

---

## 6. Flagged gaps and required UX changes (read this section before wiring any single page)

### 6.1 No admin "pending doctors" list endpoint
`doctors.service.js#listDoctors` hard-codes `role:'doctor', status:'active',
doctorProfile.status:'verified'` with no admin bypass anywhere in the doctors module's routes.
The `DoctorVerification` admin page's "pending verification" table has **no backing list call
at all** in the current API surface. Options for G2 (owns AdminPages.jsx):
- (Recommended, minimal) Leave the pending-doctors table empty with a clear
  "not available in this version of the API" `EmptyState` message, keep the
  `PATCH /doctors/:id/status` verify/reject buttons wired and functional for when a doctor id is
  known some other way (e.g. an admin who already knows a specific doctor's id/email could look
  them up — but there's no lookup-by-arbitrary-status either, so this is genuinely limited).
- Do not attempt to fake this by filtering `GET /doctors` — that endpoint fundamentally cannot
  return non-verified doctors to anyone, admin included.

### 6.2 No patient self-payment endpoint
`POST /payments` is `receptionist|admin|superadmin`-only. A patient's booking always leaves
`paymentStatus:'pending'` until staff records payment. G1 (PatientPages.jsx) must turn the
Payments page read-only and remove/relabel any "Pay Now" call-to-action that implied instant
patient-initiated payment.

### 6.3 No analytics/time-series endpoint
Only `GET /admin/dashboard-stats` (point-in-time) exists. No endpoint returns revenue-by-day/
bookings-by-week/etc. G2's `Analytics`/`RevenueReports`-style pages (if present in
AdminPages.jsx) should either be left with static/empty charts plus an explanatory note, or (if
time permits and is explicitly requested later) imperfectly bucket `GET /payments`/
`GET /appointments` paginated results client-side by `createdAt`/`appointmentDate` — NOT
attempted by default in this plan; flag it as out of scope unless a coding agent is explicitly
told to build it.

### 6.4 `DoctorFees` / `DoctorFollowUps` "Schedule" action have no real backend concept
Doctor fees are edited via `PATCH /me`'s `consultationFee`/`emergencyFee` fields, not a separate
module — G6 should merge `DoctorFees`'s form into the same submit path as `DoctorProfileEdit`'s
`updateDoctorProfile` action (§3.2), or keep it a separate page that calls the same action.
`DoctorFollowUps`'s "Schedule" button has no endpoint anywhere — leave it as a local-only
no-op/disabled with an inline comment `// no backend endpoint for scheduling a follow-up reminder`.

### 6.5 Photo upload cannot be wired
See §1.2 — no upload endpoint exists, `photoUrl` requires a real http(s) URL. Any file-picker
UI (DoctorProfileEdit, PortalProfile) should keep its local preview (harmless) but must not
attempt to submit the resulting `data:` URI to `PATCH /me` — either drop the submit-photo step
entirely or gate it behind "paste an image URL instead" if a coding agent wants to preserve some
functionality (not required).

### 6.6 Doctor self-registration does not exist
`POST /auth/register` always creates a `role:'patient'` account, full stop, even if the client
sends a different role. Remove any "I'm a doctor" toggle on the Register page (G3/G4, wherever
it lives) — a doctor account can only be created by an admin via `POST /doctors`.

### 6.7 No `patients` list endpoint
No `/patients` module exists among the 18. Any page currently reading `data.patients` (a flat
mock cache of every patient) has no direct real replacement — flag this per-page when
encountered in G1/G2/G5/G6 and either derive a best-effort distinct-patient list from
`GET /appointments`/`GET /payments` results already being fetched for that page, or show a
reduced view. Do not invent a fake endpoint call.

---

## 7. Per-group task lists

General instructions for every group: (1) import `apiClient`-backed store actions, never call
`apiClient` directly from a page component — always go through the store; (2) convert every
call site touching a "Y"-flagged action in §3.2 to `async`/`await` with try/catch and a loading-
disabled state on the trigger; (3) replace any flat money-field read (`.totalAmount`,
`.paidAmount`, `.consultationFee` etc.) with the role-masked `fees?.` optional-chained
equivalent per §1.8; (4) run `node /tmp/connect/check_jsx.js <file>` on every file you touch
before finishing; (5) reuse `LoadingSkeleton.jsx` for in-flight states and `EmptyState.jsx` for
zero-row states — do not invent new loading/empty components.

### G1 — `client/src/pages/PatientPages.jsx`
- Booking flow: rewire to the async enqueue+poll `createAppointment` (§3.2); show a
  "confirming your booking…" state referencing `LoadingSkeleton` during polling; on `'failed'`
  status, show the `error` message inline, not a silent failure.
- Family members: wire `fetchFamilyMembers`/`addFamilyMember`/`updateFamilyMember`/
  `removeFamilyMember`; drop any client-side age calculation, use the server's `age` field.
- Prescriptions/Records (patient view): wire `fetchPrescriptions`/`fetchRecords`, read-only here.
- Payments: **make read-only** (§6.2) — wire `fetchPayments`, remove/relabel "Pay Now".
- Reviews: wire `addReview`; remember a patient can't see their own pending review back via
  `fetchReviews` (§6.3/§1.14) — after submitting, show a static "submitted, pending moderation"
  confirmation instead of trying to re-fetch and display it.
- Notifications: wire `fetchNotifications`/`markNotificationRead` (use the NotificationRecipient
  `id`, not `notificationId`)/`markAllNotificationsRead`.
- Complaints: wire `fetchComplaints`(own)/`addComplaint`.
- Profile: wire `updateProfile` (PATCH /me, patient-editable fields only) and
  `changePassword` (now 3-arg; on success, force logout+redirect to login per §1.2).
- Doctor search / clinic search sub-flows if present here: use bulk-loaded `data.doctors`/
  `data.clinics`/`data.areas` (NOT `city.areas` — §1.3) or call `searchDoctors(filters)`/
  `fetchClinics(filters)` for filtered queries.

### G2 — `client/src/pages/AdminPages.jsx`
- Dashboard: wire `fetchDashboardStats`, drop all client-computed stat derivations (§1.18).
- Doctor verification: apply §6.1 — empty state + explanatory note, keep
  `updateDoctorStatus` wired for when applicable.
- Clinic approval queue: wire `fetchClinics({approvalStatus:'pending'})` /
  `approveClinic`/`rejectClinic` (reason required, 5-1000 chars).
- `ManageReceptionists`: add required email+password fields to the create form (§1.7
  convergence note), wire `addReceptionist` to the real `POST /receptionists` (needs `clinicId`).
- Platform charges: wire `fetchPlatformCharges`/`updatePlatformCharges`, apply the full
  rename/retype table in §1.13 to the form fields and submit handler.
- System settings: wire `fetchSystemSettings`/`updateSystemSettings`, rename
  `maintenance`→`maintenanceMode`.
- Booking rules (if a section exists, or add one under PlatformSettings): wire
  `fetchBookingRules`/`updateBookingRules` — this endpoint was previously entirely unwired.
- Activity log: wire `fetchActivityLog`, read `actor`/`actorRole`/`targetEntityType`/
  `targetEntityId`/`description` as distinct fields (not one pre-formatted string).
- Notifications broadcast: wire `broadcastNotification` (send) and `fetchBroadcastHistory`
  (admin log table) — these are two separate endpoints/pages, don't conflate with the personal
  inbox.
- Complaints (admin view): wire `fetchComplaints`(all)/`updateComplaint` — rename
  `response`→`adminResponse`.
- Contact requests (admin view): wire `fetchContactRequests`/`updateContactRequest`
  (`response` field name unchanged here).
- Any Analytics/RevenueReports page: apply §6.3 (leave static/flagged, do not build time-series
  client-side unless explicitly asked).
- `data.patients`-reading tables: apply §6.7.

### G3 — `client/src/pages/PublicPages.jsx`
- Doctor directory / search results / doctor detail: read from bulk-loaded `data.doctors` or
  call `searchDoctors(filters)`/`getDoctor(id)`; update all field reads to the real nested
  shape (`doctor.specialization.name` not a flat string, `doctor.clinics` array not
  `clinicId`/`clinicName`).
- Clinic search / clinic detail: same pattern via `fetchClinics`/`getClinic`; any
  `city.areas.flatMap(...)`-style code must switch to reading top-level `data.areas` filtered by
  `cityId` (§1.3/§5).
- Register page: remove the "register as doctor" toggle (§6.6); registration is always patient.
- Login page: wire `login`, handle the post-login redirect once `dataLoaded` settles (or don't
  block redirect on it — role-appropriate landing page can render its own loading states).
- Reviews display (public doctor reviews): `fetchReviews({doctorId})` — always approved-only for
  anonymous/patient callers, no client code should assume otherwise.
- Contact-us form: wire `submitContactRequest` (already public, no auth needed).

### G4 — `client/src/pages/PublicLanding.jsx`
- `ProviderLanding`'s demo-request form: repoint from `addActivity` to `submitContactRequest`
  (§3.2 addActivity row) — synthesize a subject line.
- Any doctor/clinic teaser sections: source from bulk-loaded `data.doctors`/`data.clinics`
  (already loaded pre-login per §4.1) rather than a fresh fetch on this page.

### G5 — `client/src/pages/StaffPages.jsx`
- `QueueManagement`: wire `fetchQueue`/`setQueueTokenStatus` — **fix the `'in consultation'` →
  `'in_consultation'` string** at this exact call site (§3.2). Read `patientsAhead`/
  `estimatedWaitMinutes` directly from the server response, don't recompute client-side.
- Appointments (staff view): wire `fetchAppointments`/`updateAppointmentStatus` with the
  staff-allowed target set (`confirmed|completed|cancelled|no_show`).
- Payments (staff view, e.g. front-desk collecting payment): wire `createPayment` (staff-only —
  this is the one role group that CAN hit `POST /payments`) and `fetchPayments`
  (clinic-scoped, masked to consultationFee-only per §1.8).
- Prescriptions/Records (doctor authoring view, if here rather than FeaturePages): wire
  `addPrescription` (new full medicine-object payload)/`addRecord` (rename `name`→`title`, add
  `notes`/`carePlan`).
- `data.patients`-reading tables: apply §6.7.

### G6 — `client/src/pages/FeaturePages.jsx` + `PortalSectionPages.jsx` + `PlatformCharges.jsx`
- `DoctorStaff` (receptionist creation from a doctor's own portal): converge onto the same real
  `POST /receptionists` call as G2's `ManageReceptionists` (§1.7).
- `DoctorClinics`: replace the `updateDoctor(id,{clinicId,clinicName})` misuse with real
  `assignDoctorToClinic`/`updateDoctorClinicAssignment`/`removeDoctorFromClinic` actions.
- `ClinicSchedule`: replace `saveOpdEntry`/`removeOpdEntry` with the split hours/closures
  actions per §1.5's mapping note and §5's `opdEntries` merged-view shape — each locally-held
  entry must carry its real server id plus a `kind` discriminator.
- `DoctorProfileEdit`: split the single old `updateDoctor(...)` call into
  `updateDoctorBookingPolicy` (onlineBooking/allowRebooking/maxDaysAdvance →
  `PATCH /doctors/:id`) and `updateDoctorProfile` (everything else → `PATCH /me`); admin form's
  specialization select must submit `specializationId` (UUID) sourced from bulk-loaded
  `data.specializations`, not free text.
- `DoctorFees`: apply §6.4 — merge into `updateDoctorProfile`'s submit path.
- `DoctorFollowUps`: apply §6.4 — "Schedule" stays a documented no-op.
- `PortalProfile`: wire `updateProfile`/`changePassword` (3-arg); apply §6.5 to the photo picker.
- `PlatformCharges.jsx`: wire `fetchPlatformCharges`/`updatePlatformCharges`, full rename/retype
  table (§1.13) — this may be redundant with a G2 admin section reading the same data; keep the
  store action shared (one `updatePlatformCharges` action, called from wherever this page is
  routed).

### G7 — Shell: `App.jsx`, `main.jsx`, `RoleGuard.jsx`, `Sidebar.jsx`, `SiteFooter.jsx`,
`HomeExtras.jsx`, `LiveQueueWidget.jsx`, `PortalLayout.jsx`
- **Owns** triggering the pre-login public bulk-load (§4.1) once at app boot (in `main.jsx` or a
  top-level effect in `App.jsx`, not per-page) and the post-login per-role bulk-load (§4.2)
  whenever `isAuthenticated` transitions to true (login/register success, or a successful boot-
  time session restore via `GET /me`).
- **Owns** the initial full-page loading splash (reuse `LoadingSkeleton.jsx`) gated on
  `dataLoading && !dataLoaded` (§4.3) — render this instead of the route tree until the first
  load settles, then never blank the whole app again for subsequent refetches.
- `RoleGuard.jsx`: no endpoint-shape changes needed, but confirm it reads `currentUser.role`
  (now sourced from `GET /me`, still the same field name) and gates on `isAuthenticated` — add
  handling for the boot-time "still validating session" window (`authLoading`) so a guarded
  route doesn't flash a redirect before the boot-time `GET /me` call resolves.
- `App.jsx`'s ~90 route elements: per the brief, change as little JSX as possible — the prop
  each route reads should keep being `data` (now populated by real fetches instead of the mock
  seed), so route wiring itself likely needs NO changes beyond what naturally falls out of the
  `data` shape changes in §5 (new `areas` key, restructured `queueTokens`, etc.) propagating
  into the page components that consume them (handled in G1–G6).
- `HomeExtras.jsx`: repoint its clinic-demo-request form from `addActivity` to
  `submitContactRequest` (same fix as G4's ProviderLanding instance — there are 2 call sites for
  this, both must change).
- `LiveQueueWidget.jsx`: wire to `fetchQueue`, same `in_consultation` underscore fix applies if
  this widget renders/matches on status strings anywhere.
- `SiteFooter.jsx`: check for any static content sourced from `data` (e.g. contact info) — if it
  reads platform settings, wire to `data.systemSettings`.
- `main.jsx`: no structural change expected beyond ensuring the store's boot-time session-
  restore effect fires before the app renders its route tree (or renders the G7 loading splash
  until it does).
- Delete/ignore `lib/api.js` (dead stub) and `lib/apiContracts.js` — do not import either from
  the new `apiClient.js` or the store; they are the old dead stubs referenced in the original
  brief.

---

## 8. Summary of every field-name/type rename (quick reference)

| Module | Old (mock) | New (real) |
|---|---|---|
| complaints | `response` | `adminResponse` |
| platformCharges | `commission` (string) | `commissionPercent` (float) |
| platformCharges | `patientFee` (string) | `patientConvenienceFee` (float) |
| platformCharges | `gst` (string) | `gstPercent` (float) |
| platformCharges | `applyPatientFee` | `applyConvenienceFee` |
| admin/system-settings | `maintenance` | `maintenanceMode` |
| medicalRecords | `name` (record title) | `title` |
| queue | `'in consultation'` (space) | `'in_consultation'` (underscore) |
| geography | `city.areas: string[]` (nested) | top-level `GET /geography/areas` resource |
| doctors | `doctor.status` (flat 'running'/'paused'/'disabled') | 3 separate fields: `user.status` (active/disabled), `doctorProfile.status` (pending/verified/disabled), `doctorProfile.onlineBooking` (bool) |
| doctors | `doctor.clinicId`/`clinicName` (singular) | `doctor.clinics: [{id,name,city,area}]` (array) |
| doctors | `doctor.specialization` (string) | `doctor.specialization: {id,name,icon}` (object) |
| appointments/payments | flat `.totalAmount`/`.paidAmount`/etc. | `.fees.{consultationFee,convenienceFee,emergencyFee,gstAmount,totalAmount|amount,commission?,clinicPayout?}`, role-masked |
| auth | `changePassword(current,next)` (2-arg) | `changePassword(current,next,confirm)` (3-arg) |

