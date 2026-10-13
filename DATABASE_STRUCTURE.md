# BookADoctors Database Structure

## 1. Technology

- Primary database: PostgreSQL
- ORM: Prisma
- Primary IDs: UUID strings
- Database column naming: `snake_case`
- Application field naming: `camelCase`
- Temporary registration OTP storage: Redis, not PostgreSQL
- Registration OTP validity: 5 minutes

The authoritative schema is `server/server/prisma/schema.prisma`.

## 2. High-level relationships

```text
User
├── PatientProfile (1:1)
├── DoctorProfile (1:1)
├── ReceptionistProfile (1:1)
├── RefreshToken (1:N)
├── FamilyMember (1:N, patient)
├── Appointment (1:N as patient or doctor)
├── MedicalRecord (1:N as patient or doctor)
├── Payment / PaymentHold (1:N as patient or doctor)
├── Review (1:N as patient or doctor)
└── NotificationRecipient / Complaint / ActivityLog

Clinic
├── DoctorClinic (N:M between doctors and clinics)
├── DoctorClinicHours (1:N)
├── DoctorClinicClosure (1:N)
├── ReceptionistProfile (1:N)
├── Appointment (1:N)
├── QueueToken (1:N)
└── Payment (1:N)

Appointment
├── QueueToken (1:1)
├── Payment (1:N)
├── Refund (1:N)
├── PaymentHold (1:N)
├── MedicalRecord (1:N)
└── Review (0..1)
```

## 3. Authentication and users

### `users`

Central account table for patients, doctors, receptionists and administrators.

Important columns:

- `id` UUID, primary key
- `email` unique
- `password_hash` nullable for Google-only users
- `google_id` nullable and unique
- `role`: patient, doctor, receptionist, admin or superadmin
- `name`, `phone`, `city`, `photo_url`
- `status`: active or disabled
- `patient_number` unique human-readable sequence used as `DCP<N>`
- `created_at`, `updated_at`

### `refresh_tokens`

- `id`, `user_id`, `token_hash`
- `expires_at`, `revoked_at`, `created_at`
- Deleted automatically when the owning user is deleted.

### `patient_profiles`

- Primary/foreign key: `user_id`
- `date_of_birth`, `gender`, `blood_group`
- `emergency_contact`, `address`, `medical_history`, `about`

### `doctor_profiles`

- Primary/foreign key: `user_id`
- `specialization_id`, `qualification`, `registration_number`
- `experience_years`, `languages`, `bio`
- `consultation_fee`, `emergency_fee`, `min_booking_advance_amount`
- `rating`, `review_count`, `status`
- `verification_documents`
- Online-booking controls and daily booking limits
- Booking-window start/end and maximum advance days
- Emergency availability
- Bank account and UPI payout fields
- Token-numbering mode and online token parity
- `doctor_number` unique human-readable sequence used as `DCD<N>`

### `receptionist_profiles`

- Primary/foreign key: `user_id`
- `clinic_id` nullable foreign key
- `since`

## 4. Clinics and directory data

### `clinics`

- `id`, `name`, `phone`, `address`
- `city_id`, `area_id`
- `approval_status`, `rejection_reason`
- `emergency_available`
- Cash/UPI payment settings, UPI ID and QR URL
- `clinic_number` unique human-readable sequence used as `DCC<N>`
- `created_at`, `updated_at`

### `doctor_clinics`

Many-to-many link between doctors and clinics.

- Composite primary key: `doctor_user_id + clinic_id`
- `is_owner`, `is_primary`, `online_booking`

### `doctor_clinic_hours`

- `doctor_user_id`, `clinic_id`
- `weekday`, `start_time`, `end_time`, `slot_minutes`, `status`
- One unique schedule per doctor, clinic and weekday.

### `doctor_clinic_closures`

- `doctor_user_id`, `clinic_id`
- `closed_date`, `reason`

### `cities`

- `id`, `name`, `state`

### `areas`

- `id`, `city_id`, `name`, `pincode`

### `specializations`

- `id`, unique `name`, `icon`, `description`

## 5. Appointments and queue

### `appointments`

- `id`
- `patient_user_id`, optional `family_member_id`
- `doctor_user_id`, optional `clinic_id`
- `appointment_date`, `appointment_time`, `reason`
- `is_emergency`, `source`, `status`
- `token_number`
- Consultation, convenience, emergency, GST and total amounts
- `payment_status`, `payment_method`
- `checked_in_at`, `notes`, `created_at`, `updated_at`

Appointment status flow:

```text
pending_payment -> upcoming -> confirmed -> completed
                                  ├── cancelled
                                  └── no_show
```

A PostgreSQL partial unique index prevents active double-booking for the same doctor, date and time.

### `queue_tokens`

- `id`, unique `appointment_id`
- `doctor_user_id`, optional `clinic_id`
- `token_number`, `queue_date`, `status`, `updated_at`

Queue status flow:

```text
on_hold -> waiting -> called -> in_consultation -> completed
```

## 6. Patient health data

### `medical_records`

- `id`, `patient_user_id`, `doctor_user_id`
- Optional `appointment_id`
- `title`, `type`, `notes`, `care_plan`, `created_at`

### `family_members`

- `id`, `patient_user_id`
- `name`, `relation`, `date_of_birth`, `gender`, `blood_group`
- A family member cannot be deleted while appointments still reference it.

## 7. Payments and revenue

### `payments`

- `id`, unique `receipt_number`
- Optional `appointment_id` and `clinic_id`
- `patient_user_id`, `doctor_user_id`
- Fee breakdown and final `amount`
- `mode`, `transaction_ref`, `payer_upi_id`, `status`, `created_at`

### `refunds`

- `id`, `appointment_id`, `payment_id`, `amount`
- Razorpay payment/refund IDs
- `status`, `failure_reason`
- Unique `idempotency_key`
- `created_at`, `updated_at`

### `payment_holds`

- `id`, `appointment_id`, `doctor_user_id`, `patient_user_id`
- `appointment_date`, unique optional `razorpay_order_id`
- `status`, `hold_created_at`, `hold_expires_at`
- `created_at`, `updated_at`

### `platform_charges`

Singleton configuration row with `id = 1`:

- `commission_percent`
- `patient_convenience_fee`
- `emergency_fee`, `gst_percent`
- Fee enable/disable switches
- `updated_at`

## 8. Reviews, notifications and support

### `reviews`

- `id`, unique `appointment_id`
- `doctor_user_id`, `patient_user_id`
- `rating`, `text`, `status`, `created_at`
- Approved reviews automatically update the doctor's rating and review count through a database trigger.

### `notifications`

- `id`, `title`, `body`, `type`
- Optional sender and single target user
- `audience`, `created_at`

### `notification_recipients`

- `notification_id`, `user_id`, `read_at`
- Unique pair: notification + user

### `complaints`

- `id`, `raised_by_user_id`
- `subject`, `description`, `status`, `admin_response`
- `created_at`, `updated_at`

### `contact_requests`

- `id`, `name`, `email`, `subject`, `message`
- `status`, `response`, `created_at`

## 9. Administration and audit

### `system_settings`

Singleton platform configuration:

- `platform_name`, support email/phone
- `booking_fee`, `maintenance_mode`, `updated_at`

### `booking_rules`

Singleton booking policy:

- Cancellation window
- Maximum bookings per patient
- Default slot duration
- Platform online-booking time window
- Maximum advance booking days
- `updated_at`

### `activity_log`

- `id`, optional `actor_user_id`, `actor_role`, `ip_address`
- `action_type`
- Target entity type and ID
- `description`, `created_at`

## 10. Enums

- `UserRole`: patient, doctor, receptionist, admin, superadmin
- `AccountStatus`: active, disabled
- `DoctorStatus`: pending, verified, disabled
- `ClinicApprovalStatus`: pending, active, disabled
- `AppointmentStatus`: pending_payment, upcoming, confirmed, completed, cancelled, no_show
- `AppointmentSource`: online, walk_in
- `PaymentStatus`: pending, partial, paid, refunded
- `PaymentMode`: cash, upi, card, online
- `QueueStatus`: on_hold, waiting, called, in_consultation, completed
- `ReviewStatus`: pending, approved, rejected
- `ComplaintStatus`: open, in_progress, resolved, closed
- `ContactStatus`: open, responded, resolved
- `NotificationAudience`: all, patients, doctors, receptionists, single_user

## 11. Security and integrity controls

- Password hashes are stored instead of plaintext passwords.
- Google-only accounts may have no password hash.
- Email and Google account identifiers are unique.
- Email uniqueness is case-insensitive and surrounding whitespace is normalized.
- All user-creation paths store phone numbers in one canonical digit-only format before the
  database unique constraint is evaluated.
- Refresh tokens are stored as hashes and can be revoked.
- Registration OTPs live temporarily in Redis and are consumed after successful verification.
- UUIDs are used for public primary keys.
- Foreign keys protect relational integrity.
- Cascading deletes are used only where child records should disappear with the parent.
- Appointment slot uniqueness prevents active double-bookings.
- Payment/refund idempotency protects against duplicate financial operations.
- Database indexes cover the main search, appointment, queue, payment and audit queries.
- Identical simultaneous browser GET requests share one HTTP request, and identical simultaneous
  server cache misses share one database query per API process.
