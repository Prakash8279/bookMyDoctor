-- Doctor Connect — additive supplement for the Directory & Reference Data phase.
--
-- FLAGGED, ADDITIVE-ONLY SCHEMA CHANGE — see the comment on `ReceptionistProfile.clinicId` in
-- prisma/schema.prisma for full rationale. Short version: DATABASE_SCHEMA.md §2 says receptionist
-- clinic-assignment "lives in `clinic_staff` below", but that table was never actually defined —
-- an authoring gap, not a deliberate decision to leave receptionists unscoped to a clinic. This
-- phase's brief explicitly requires a receptionist to be "tied to a specific clinic", which has
-- no schema-legal, non-hacky implementation without a queryable clinic_id column somewhere.
--
-- This statement is purely additive (new nullable column + index + FK — nothing existing is
-- renamed, retyped, or dropped) and is normally what `npx prisma migrate dev --name
-- add_receptionist_clinic` would generate from the schema.prisma edit made alongside this file.
-- It is captured here, by hand, because this environment has no DB/network access to actually
-- run `prisma migrate dev`. Run this AFTER the Prisma-generated migration for the rest of the
-- schema has been applied, and treat it as needing the same explicit review/sign-off as any
-- other schema change before it touches a real database.
--
-- Idempotent (safe to re-run) via IF NOT EXISTS.

-- clinic_id is TEXT, not UUID: every id in this schema is Prisma's plain `String @default(uuid())`
-- (no `@db.Uuid`), which maps to a Postgres TEXT/VARCHAR column, not the native `uuid` type — so
-- the FK target (clinics.id) is TEXT and this column must match or the constraint cannot be
-- created at all ("incompatible types: uuid and text"). Caught by hand-applying this file against
-- a real local Postgres instance in the sandbox this was built in; verify again if you ever add a
-- genuinely native-uuid-typed id anywhere in this schema.
ALTER TABLE receptionist_profiles
  ADD COLUMN IF NOT EXISTS clinic_id TEXT REFERENCES clinics(id);

CREATE INDEX IF NOT EXISTS receptionist_profiles_clinic_id_idx
  ON receptionist_profiles (clinic_id);
