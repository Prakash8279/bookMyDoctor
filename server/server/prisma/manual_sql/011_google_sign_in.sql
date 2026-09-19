-- BookMyDoctor24 — "Continue with Google" sign-in (user request: "google work nahi kar rah hai
-- fix kro" — the Google button on the login/register pages was a non-functional stub before
-- this change; see auth.service.js#googleAuth).
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE, same reason 001-010 are hand-written: this sandbox has
-- no DB/network access to run `npx prisma migrate dev`. Run this by hand via psql/pgAdmin
-- against the real database.
--
-- Two changes to `users`:
--   1. `google_id` — Google's stable per-account identifier (the verified ID token's `sub`
--      claim), set the first time a person signs in with Google. NULL for every account that has
--      only ever used email+password. Unique or plain NULL, never a duplicate: Postgres allows
--      any number of NULLs through a unique index (each NULL is treated as distinct), so this
--      doesn't collide with any of the (many) existing rows that have never used Google sign-in.
--   2. `password_hash` becomes NULLABLE — a brand-new account created via "Continue with Google"
--      has no password at all until/unless the person later sets one. auth.service.js#login
--      already treats a NULL password_hash the same as "no matching user" (falls back to its
--      constant-time DUMMY_PASSWORD_HASH compare), so this can never be used to log into a
--      Google-only account with a guessed/blank password.
--
-- Idempotent (safe to re-run): ADD COLUMN uses IF NOT EXISTS, the unique index uses IF NOT
-- EXISTS, and DROP NOT NULL is a no-op if the column is already nullable.

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_key ON users (google_id);
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
