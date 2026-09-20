-- BookMyDoctor24 — LOAD-REVIEW FIX (audit findings #2 and #3, docs/data-load-review-2026-09-20.md):
--
-- 1. `ActivityLog.actionType` filter has no index. admin.service.js#getActivityLog filters this
--    table by actionType (an admin-facing activity-log screen) and always sorts/paginates by
--    createdAt desc. A 30-second cache keeps today's load low, but this table only ever grows —
--    one row is written per admin/system action, never pruned — so the filter degrades as the
--    table grows. Composite (actionType, createdAt) serves both the filter and the sort in one
--    index.
--
-- 2. `Notification` table has no index at all. Low priority — it only grows from admin broadcasts
--    (not per-user events) and notifications.service.js#listBroadcasts is already cached — added
--    here for future-proofing since that query always sorts by createdAt desc.
--
-- Both index names match exactly what Prisma's `@@index([...])` generates for these
-- columns/tables, so schema.prisma and this hand-written SQL never drift apart (see
-- prisma/migrations/20260919130000_add_patient_doctor_clinic_numbers/migration.sql for the same
-- naming convention).
--
-- IDEMPOTENT: CREATE INDEX IF NOT EXISTS — safe to re-run against a database that already has
-- this from a partial/retried run, and safe against a brand-new database. Read-only otherwise —
-- no data is touched, no column is added, so this can run on a live table with zero downtime risk
-- beyond the normal cost of building an index.

CREATE INDEX IF NOT EXISTS "activity_log_action_type_created_at_idx" ON "activity_log" ("action_type", "created_at");

CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications" ("created_at");
