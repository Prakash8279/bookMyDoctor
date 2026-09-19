-- Migration-drift fix (completeness audit Priority 4): schema.prisma's User model has declared
-- `@@index([role, createdAt])` since the admin.service.js#listPatients scalability pass, but the
-- migration that should have created it was never written — this file is that missing migration,
-- run now instead of via `prisma migrate dev` (no live DB access from this environment; see this
-- repo's other hand-authored migrations for the same reason).
--
-- Replaces the old bare `users_role_idx` (from the initial migration) rather than adding a
-- second index alongside it: schema.prisma's own comment on this field explains why a composite
-- (role, created_at) index is a strict superset of a bare (role) index (role stays the leading
-- column), so keeping both would only waste write-side index-maintenance cost for zero read-side
-- benefit.
DROP INDEX IF EXISTS "users_role_idx";

CREATE INDEX "users_role_created_at_idx" ON "users"("role", "created_at");
