# BookMyDoctor24 — Database, Data Modeling & Storage Architecture

This document provides the definitive architectural specification for database schemas, entity relationships, database triggers, indexing strategies, Redis keyspaces, and file storage in **BookMyDoctor24**.

---

## 💾 Core Persistence Technology Stack

- **Relational Database:** PostgreSQL 16
- **Object-Relational Mapping (ORM):** Prisma (`server/server/prisma/schema.prisma`)
- **Primary Keys:** UUID v4 strings (`@id @default(uuid())`) across all relational tables
- **Naming Conventions:**
  - Database Table & Column Names: `snake_case` (e.g., `doctor_id`, `created_at`)
  - Application Domain Model Fields: `camelCase` (e.g., `doctorId`, `createdAt`) mapped via `@map`
- **In-Memory Store:** Redis 7 (Cache-aside, distributed mutex locks, BullMQ queue, ephemeral OTPs)
- **File System / Media Storage:** Local file system with S3-compatible path abstractions

---

## 🗺️ Entity-Relationship Diagram (ERD)

```mermaid
erDiagram
    users ||--o| patient_profiles : "1:1"
    users ||--o| doctor_profiles : "1:1"
    users ||--o| receptionist_profiles : "1:1"
    users ||--o{ refresh_tokens : "1:N"
    users ||--o{ family_members : "1:N (patient)"
    users ||--o{ appointments : "1:N (as patient or doctor)"
    users ||--o{ medical_records : "1:N (as patient or doctor)"
    users ||--o{ payments : "1:N"
    users ||--o{ reviews : "1:N"
    users ||--o{ complaints : "1:N"
    users ||--o{ activity_logs : "1:N (admin actions)"

    clinics ||--o{ doctor_clinics : "1:N (N:M Doctor-Clinic)"
    doctor_profiles ||--o{ doctor_clinics : "1:N"
    doctor_clinics ||--o{ doctor_clinic_hours : "1:N"
    doctor_clinics ||--o{ doctor_clinic_closures : "1:N"
    clinics ||--o{ receptionist_profiles : "1:N"
    clinics ||--o{ appointments : "1:N"
    clinics ||--o{ queue_tokens : "1:N"

    appointments ||--o| queue_tokens : "1:1"
    appointments ||--o{ payments : "1:N"
    appointments ||--o{ refunds : "1:N"
    appointments ||--o{ payment_holds : "1:N"
    appointments ||--o{ medical_records : "1:N"
    appointments ||--o| reviews : "0..1"

    users {
        uuid id PK
        string email UK
        string password_hash
        string google_id UK
        string role "patient, doctor, receptionist, admin, superadmin"
        string name
        string phone
        string city
        string status "active, disabled"
        string patient_number UK "DCP<N>"
        timestamp created_at
    }

    doctor_profiles {
        uuid user_id PK,FK
        uuid specialization_id FK
        string qualification
        string registration_number
        int experience_years
        decimal consultation_fee
        decimal emergency_fee
        decimal rating "Trigger-computed"
        int review_count "Trigger-computed"
        string status "active, pending_verification, rejected"
        string doctor_number UK "DCD<N>"
        text bank_account_number "AES-256-GCM Encrypted"
        text bank_ifsc_code "AES-256-GCM Encrypted"
    }

    appointments {
        uuid id PK
        string appointment_number UK
        uuid patient_id FK
        uuid doctor_id FK
        uuid clinic_id FK
        date appointment_date
        string slot_time
        string status "confirmed, in_consultation, completed, cancelled, no_show"
        decimal consultation_fee
        string payment_status "pending, paid, refunded"
    }

    queue_tokens {
        uuid id PK
        uuid appointment_id FK,UK
        uuid clinic_id FK
        int token_number
        string status "waiting, called, in_consultation, completed, skipped"
        date token_date
    }

    payments {
        uuid id PK
        string receipt_number UK
        uuid appointment_id FK
        decimal amount
        string method "cash, upi, card, online_razorpay"
        string status "completed, refunded, pending"
    }
```

---

## 🏛️ Schema Architecture & Core Tables

### 1. Identity & Profile Tables
- **`users`:** Central identity registry. Stores authentication credentials, OAuth identifiers, contact info, and system-wide account status (`active` or `disabled`).
- **`patient_profiles`:** 1:1 extension of `users` for patients. Stores demographic data (`date_of_birth`, `gender`, `blood_group`), `emergency_contact`, and medical history summaries.
- **`doctor_profiles`:** 1:1 extension of `users` for doctors. Contains clinical qualifications, medical registration number, experience years, consultation fees, live rating/review counters, and AES-256-GCM encrypted bank payout credentials.
- **`receptionist_profiles`:** 1:1 extension linking receptionists to their assigned `clinic_id`.
- **`refresh_tokens`:** Hashed storage of active JWT refresh tokens. Rotated single-use tokens automatically cascade-delete when the owning user is removed.

### 2. Clinic & Scheduling Tables
- **`clinics`:** Clinic entities including geographic coordinates, full address, contact numbers, and approval status (`active`, `pending_approval`, `rejected`).
- **`doctor_clinics`:** N:M junction linking doctors to clinics. Controls doctor status at specific facilities (`active`, `inactive`).
- **`doctor_clinic_hours`:** Weekly recurring OPD consultation schedules by day of week (`0` = Sunday through `6` = Saturday), start time, end time, and maximum token capacity.
- **`doctor_clinic_closures`:** Specific calendar date ranges when OPD is closed (e.g. physician vacations or clinic maintenance).

### 3. Consultation & Clinical Tables
- **`appointments`:** The core operational table. Tracks patient, doctor, clinic, slot date/time, consultation status, and financial state.
- **`queue_tokens`:** Tracks the physical OPD token number (`token_number`) and live progression (`waiting` $\rightarrow$ `called` $\rightarrow$ `in_consultation` $\rightarrow$ `completed`).
- **`medical_records`:** Electronic Medical Record (EMR) entries created exclusively by doctors. Stores symptoms, clinical diagnosis, JSON-structured medication prescriptions, and recommended lab tests.

### 4. Financial & Payment Tables
- **`payments`:** Financial transaction ledger. Maps receipts to appointments with method breakdown (`cash`, `upi`, `card`, `online_razorpay`).
- **`refunds`:** Tracks refund requests, approval status, gateway refund identifiers, and failure retry counters.
- **`payment_holds`:** Ephemeral holds placed during checkout to guarantee slot reservation pending payment gateway confirmation.
- **`platform_charges`:** Singleton configuration tracking platform service fees and tax percentages.

---

## ⚡ Database Constraints, Triggers & Sequences

### 1. Double-Booking Prevention (Partial Unique Index)
To prevent race conditions where two patients reserve the same doctor slot simultaneously, PostgreSQL enforces a partial unique index:
```sql
CREATE UNIQUE INDEX idx_unique_active_slot
ON appointments (doctor_id, appointment_date, slot_time)
WHERE status NOT IN ('cancelled', 'rejected');
```
*Why partial?* If an appointment is cancelled, that specific `(doctor_id, appointment_date, slot_time)` immediately becomes available for re-booking without violating database constraints.

### 2. Doctor Rating Recomputation Trigger
Instead of computing doctor ratings in application code, a PostgreSQL trigger automatically recalculates `rating` and `review_count` whenever a review status becomes `approved`:
```sql
CREATE OR REPLACE FUNCTION recompute_doctor_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE doctor_profiles
    SET
        rating = COALESCE((
            SELECT ROUND(AVG(rating)::numeric, 1)
            FROM reviews
            WHERE doctor_id = COALESCE(NEW.doctor_id, OLD.doctor_id)
              AND status = 'approved'
        ), 0.0),
        review_count = (
            SELECT COUNT(*)
            FROM reviews
            WHERE doctor_id = COALESCE(NEW.doctor_id, OLD.doctor_id)
              AND status = 'approved'
        )
    WHERE user_id = COALESCE(NEW.doctor_id, OLD.doctor_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recompute_doctor_rating
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION recompute_doctor_rating();
```

### 3. Sequence Identifiers
Human-friendly sequences are managed via dedicated PostgreSQL sequences:
- `patient_number_seq`: Generates unique patient numbers prefixed with `DCP` (e.g. `DCP1001`).
- `doctor_number_seq`: Generates doctor IDs prefixed with `DCD` (e.g. `DCD1001`).
- `appointment_number_seq`: Formatted as `B<YYMMDD>-<SEQ>`.
- `payment_receipt_seq`: Formatted as `REC-<YYMM>-<SEQ>`.

### 4. Singleton Constraint Enforcement
System-wide configuration tables (`system_settings` and `booking_rules`) must contain exactly one row:
```sql
ALTER TABLE system_settings ADD CONSTRAINT chk_singleton_system_settings CHECK (id = 1);
ALTER TABLE booking_rules ADD CONSTRAINT chk_singleton_booking_rules CHECK (id = 1);
```

---

## 🔍 Indexing & Query Optimization

To maintain sub-20ms query response times under high load, the following indices are maintained:

1. **Trigram Fuzzy Search (`pg_trgm`):**
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX idx_trgm_users_name ON users USING gin (name gin_trgm_ops);
   CREATE INDEX idx_trgm_clinics_name ON clinics USING gin (name gin_trgm_ops);
   CREATE INDEX idx_trgm_doctor_qualification ON doctor_profiles USING gin (qualification gin_trgm_ops);
   ```
   Enables fast wildcard and typo-tolerant search across patient and doctor discovery queries.

2. **High-Frequency Compound Query Indices:**
   - `appointments(doctor_id, appointment_date, status)`
   - `appointments(patient_id, created_at DESC)`
   - `queue_tokens(clinic_id, token_date, status)`
   - `payments(appointment_id, status)`

---

## ⚡ Redis In-Memory Keyspace & Data Structures

Redis is used for caching, distributed locking, background queues, and ephemeral state:

```text
Redis Keyspace
├── cache:                      # Cache-aside cached JSON payloads
│   ├── doctors:list:*          # Public directory listings (TTL: 60s)
│   ├── queue:live:<clinicId>   # Live clinic queue tokens (TTL: 10s)
│   └── appointments:list:*     # Role-scoped appointment views (TTL: 30s)
│
├── lock:                       # Distributed mutex locks (TTL: 10s lease)
│   └── slot:<docId>:<date>:<slot>
│
├── otp:                        # Ephemeral registration verification codes
│   └── register:<email>        # 6-digit OTP code (TTL: 300s / 5 minutes)
│
├── rl:                         # Distributed rate limiting counters
│   ├── auth:<ip>               # 15-minute sliding window counters
│   └── user:<userId>           # User-keyed booking/payment counters
│
└── bull:booking-queue:*        # BullMQ Redis Streams, Sorted Sets & Hashes
```

---

## 📂 File Storage Hierarchy

Files are stored locally (with S3-compatible path mapping in production) under `server/server/uploads/`:

```text
uploads/
├── photos/                     # Public user avatars & profile photos
│   └── <uuid>.webp             # Max 5MB, converted/stored via Multer
│
├── qr/                         # Public clinic payment UPI QR codes
│   └── <uuid>.png              # Served directly via express.static('/uploads')
│
└── documents/                  # PRIVATE Doctor KYC & Registration Documents
    └── <uuid>.pdf              # Max 10MB, restricted access via HMAC signed tokens
```
