# Receptionist release review — 20 October 2026

## Implemented and reviewed

- Real staff-only patient arrival endpoint: POST /appointments/:id/check-in. Clinic/doctor ownership, India visit-date check, token/payment eligibility, idempotency, atomic cancellation-race guard, audit entry and cache invalidation.
- Receptionist slot availability is forced to the assigned clinic on the server, regardless of a supplied clinicId. An unassigned receptionist sees no clinic availability.
- Walk-in doctor choices use IDs, not names, preventing ambiguous selection when two doctors share a name. Visit dates use IST.
- Today's dashboard uses all pages of today's clinic appointments/queue. Cancelled, no-show and pending-payment reservations are excluded from patient/consultation counts; actual unpaid appointment balances drive pending collections.
- Queue auto-refresh pauses in hidden tabs through the shared polling hook.
- Appointments: date/status filters, server pagination, complete date-range CSV export, existing cancel/no-show/complete actions and compact mobile summaries.
- Payments: fresh complete clinic appointment/payment lists, paid/partial balance handling, cancelled/refunded guards, refunded amounts excluded from collection summaries, paginated receipts and a refresh action.
- Patient directory loads all clinic appointment pages and supports patient name/phone search. It does not add access to clinical records.
- Reports load every clinic payment/appointment page, count actual walk-ins/arrivals and retain refunded receipts without treating them as collections.
- Existing login, notifications, receptionist provisioning, queue, payment and clinic permission suites are included in regression checks.

## Verification boundaries

- Automated service/UI regression tests and the production web build are the release checks; no fake production patient, payment, refund or consultation is created as a smoke test.
- Reports show all-time gross doctor-charge collections, excluding fully refunded/failed/pending payments; they are not a bank-settlement or partial-refund accounting statement.
- Complete-record reads stop with an explicit error above 1,000 pages rather than silently returning a partial report. Large-clinic load/concurrency benchmarking is not claimed.
- The senior-review follow-up includes StaffPages role-gating tests without excluding them. This is not a claim that the entire frontend suite passes.
- No new Android/iOS binary or Play Store release is included.

## Staff acceptance checklist

Using an existing receptionist account assigned to a real clinic: verify clinic doctors, select a valid existing booking for today's check-in, observe queue progression, review the unpaid dropdown and receipts, and download a chosen date range. Perform real collections only for actual money received. Admin must assign unassigned receptionist accounts to the correct clinic.

## Senior-review follow-up

- Serialize promise-returning polling callbacks, including reception dashboard refreshes, to avoid overlapping slow requests; failed polls release their lock.
- Shared clinic appointment/payment/queue list responses cannot overwrite a newer request or repopulate data after the session changes. Staff writes invalidate outstanding list snapshots.
- Payment selection uses the full booking ID as the option value, independent of display labels; the label uses the actual remaining balance when supplied.
- Preserve server truncation metadata and reject incomplete full-record reads; honor explicit server pagination even when a page contains fewer than 100 rows. Offset pagination remains a live view, not a transactional export snapshot.
- Recheck refund, token and visit date when a concurrent check-in changed the row. Backend cache invalidation is already best-effort; no new Redis failure semantics are required.
- Surface stale dashboard totals when refresh fails. No production booking/payment mutation is part of release verification.
