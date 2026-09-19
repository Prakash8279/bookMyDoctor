# DB Test-Data Reset — Detailed Approach

## Background

Testing the platform-charge/emergency-fee mutual-exclusivity fix (before the server was restarted onto the fixed code) left behind duplicate `pending_payment` appointments with the old, buggy stacked-fee totals (e.g. ₹592.25 instead of the correct ₹566.5). The code bug itself is already fixed and covered by automated tests (`appointments.service.test.js`, `payments.service.test.js`). What remains is cleaning the leftover bad rows out of the database without touching any login account.

A single ad-hoc `DELETE` pasted into pgAdmin would work, but it is a one-time, unreviewed action with no backup, no scoping, and no way to reuse it next time this happens. This plan replaces that with a repeatable, safer process.

## Step 1 — Back up before touching anything

Even on a dev/test database, take a backup of just the three tables being modified. This costs seconds and makes every later step reversible.

```
pg_dump "<your DATABASE_URL>" -t appointments -t payments -t reviews -f backup_before_reset.sql
```

Run this from your own terminal (not inside the app), using the same `DATABASE_URL` value from `server/server/.env`. Keep the resulting file until you're confident you don't need to restore anything from it.

## Step 2 — Decide scope: time-scoped vs. full wipe

Two options, both implemented in `server/server/scripts/reset_test_data.sql`:

- **Time-scoped (default, recommended)** — only removes appointments/payments/reviews created on or after a cutoff date you set. This protects any data that existed before your test session, so a blanket mistake can't erase something you didn't mean to touch. This is the right choice whenever the database might hold anything you're not 100% sure is disposable.
- **Full wipe** — removes every appointment, payment, and review regardless of date. Only choose this when you are certain every row in these three tables is test data and none of it needs to survive (for example, a database that has never been used for anything but this testing round).

The script has both modes written out with the full-wipe lines commented by default — swap the comments to switch modes.

## Step 3 — Preview before deleting

Before running any `DELETE`, run a `SELECT COUNT(*)` with the same `WHERE` clause you're about to delete with. The script includes this as "Step 0." Knowing the row count in advance means you notice immediately if it's much bigger or smaller than expected — a cheap sanity check that catches mistakes before they become permanent.

## Step 4 — Run the reset script, not a fresh ad-hoc query

`server/server/scripts/reset_test_data.sql` is now the canonical way to do this. It:

1. Deletes `reviews` first (a review's `appointment_id` is `NOT NULL` with an `ON DELETE RESTRICT` foreign key, so a reviewed appointment can't be deleted while its review still exists).
2. Deletes `payments` (including standalone/counter payments with no appointment link).
3. Deletes `appointments` (this cascades `queue_tokens` automatically; any `medical_records` referencing a deleted appointment just get `appointment_id` set to `NULL` — the medical record itself is kept).
4. Runs a final count check across `appointments`, `payments`, `reviews`, `queue_tokens`, and `users` before the transaction commits.

It never references the `users` table, so every login account (doctor, patient, receptionist, admin, superadmin demo credentials) is guaranteed untouched no matter which mode you run.

Run it with:

```
psql "<your DATABASE_URL>" -f server/server/scripts/reset_test_data.sql
```

or paste the whole file into pgAdmin's Query Tool and execute it as one script.

## Step 5 — Verify, and know your rollback path

Read the final `SELECT`'s output. `users_untouched` should exactly match the `users` count from before you ran anything — if it doesn't, stop and restore from the Step 1 backup rather than continuing.

For an extra safety net beyond the transaction itself: run the script interactively in `psql` (not `psql -f`, and not pgAdmin's single-script execute, both of which auto-commit at the end) — paste everything up to but not including `COMMIT;`, inspect the counts, and only then type `COMMIT;` or `ROLLBACK;` yourself.

## Longer-term improvements worth considering

- **Separate dev/test and eventual-production databases.** Right now one database is being used for everything, which is exactly why "is this safe to delete?" needed a conversation at all. Before this app goes live, point production at its own database (e.g. `doctor_connect` for prod, `doctor_connect_dev` for local testing) so test data never has to be reasoned about against real user data.
- **Prefer automated tests over manual test bookings.** The fee-calculation bug that caused this cleanup was already caught and locked in by the Jest/Vitest suites added this session. Going forward, verifying a business-rule change (like the platform-charge/emergency-fee exclusivity) through an automated test first — rather than clicking through the UI repeatedly — avoids creating this kind of leftover data in the first place, and catches regressions immediately rather than after they've already produced bad rows.
- **Keep the reset script under version control.** `server/server/scripts/reset_test_data.sql` should be committed alongside the rest of the code (the same way `prisma/manual_sql/seed_demo_data.sql` already is), so it's available and reviewed the next time a reset is needed, instead of being reconstructed from scratch or from chat history.
