-- BookMyDoctor24 — fix for risky-item #3 (docs/risky-fixes-plan-2026-09-20.md, doctor bank-detail
-- encryption): the 5 bank/payout columns on doctor_profiles were created (in
-- 20260919120000_consolidate_manual_sql_baseline) as VARCHAR with lengths sized for PLAINTEXT
-- values — e.g. bank_ifsc_code VARCHAR(11) for an 11-character IFSC code. AES-256-GCM ciphertext
-- in the `enc:v1:<base64(iv||authTag||ciphertext)>` format (see
-- src/services/encryptionService.js) is always longer than the plaintext it replaces (12-byte IV
-- + 16-byte auth tag + the ciphertext itself, all base64-encoded, plus a 7-char prefix) — for
-- bank_ifsc_code specifically, an 11-char plaintext becomes ~59 characters of ciphertext, which
-- does not fit in VARCHAR(11) at all. Running scripts/encryptExistingBankDetails.js against the
-- un-widened columns fails with Postgres error P2000 ("value too long for column's type") on the
-- very first row it tries to write.
--
-- FIX: widen all 5 columns to TEXT (no length cap). This also brings the physical database in
-- line with the logical Prisma schema (schema.prisma already declares these as plain `String?`
-- with no `@db.VarChar(...)` attribute, which Prisma's Postgres connector maps to `text` by
-- default) — the VARCHAR limits only existed because 20260919120000 was hand-written raw SQL
-- rather than a `prisma migrate dev`-generated one, so this migration also resolves that drift.
--
-- SAFE / IDEMPOTENT: widening VARCHAR(n) -> TEXT never loses data (every existing value already
-- fits, since it was already valid VARCHAR(n)) and needs no USING clause. Running this twice, or
-- against a column that is already TEXT, is a harmless no-op. No rows are read or written by this
-- migration — it only changes column metadata.

ALTER TABLE doctor_profiles ALTER COLUMN bank_account_holder_name TYPE TEXT;
ALTER TABLE doctor_profiles ALTER COLUMN bank_account_number TYPE TEXT;
ALTER TABLE doctor_profiles ALTER COLUMN bank_ifsc_code TYPE TEXT;
ALTER TABLE doctor_profiles ALTER COLUMN bank_name TYPE TEXT;
ALTER TABLE doctor_profiles ALTER COLUMN bank_upi_id TYPE TEXT;
