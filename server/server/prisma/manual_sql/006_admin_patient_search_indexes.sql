-- BookMyDoctor24 — admin patient-directory search indexes.
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE, hand-written for the same reason 005 is: this sandbox
-- has no DB/network access to run `npx prisma migrate dev`, and a GIN trigram index has no
-- Prisma schema DSL representation at all. Run this by hand via psql/pgAdmin against the real
-- database, AFTER 001-005 already exist (005 already creates the pg_trgm extension this file
-- reuses, so it's safe to run this after 005 specifically, or in any order relative to 002-004).
--
-- Context: admin.service.js#listPatients (added when the admin "how many patients registered"
-- feature was built) searches `users` with an OR across name/email/phone, all using leading-
-- wildcard `contains`/`insensitive` (Prisma compiles this to `ILIKE '%term%'`). 005 already
-- covers `users.name` for the doctor-search path; this same OR-search on the PATIENT directory
-- also hits email/phone, which had no supporting index at all — those two columns forced a
-- sequential scan over the entire users table on every patient search. A plain btree index
-- cannot serve a leading-wildcard ILIKE (the leading `%` defeats a left-anchored index scan), so
-- this uses the same pg_trgm GIN approach as 005.
--
-- Idempotent (safe to re-run): every statement uses IF NOT EXISTS, and CREATE EXTENSION IF NOT
-- EXISTS is itself idempotent. Building a GIN trigram index locks out writes to the target table
-- for the duration (CREATE INDEX CONCURRENTLY would avoid that but cannot run inside a
-- transaction block) — apply during a low-traffic window on a live database with real data
-- volume, same caveat as 005.
--
-- Also see the matching schema.prisma comment on the User model: @@index([role]) was widened to
-- @@index([role, createdAt]) there, which IS expressible in Prisma's DSL — that part will be
-- picked up automatically the next time `prisma migrate dev` runs with real DB access, no manual
-- SQL needed for it. Only the two trigram indexes below need this hand-written file.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS users_email_trgm_idx
  ON users USING gin (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS users_phone_trgm_idx
  ON users USING gin (phone gin_trgm_ops);
