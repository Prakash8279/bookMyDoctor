# Android functional audit — 22 October 2026

## Confirmed bugs corrected

- Booking dates are normalized to India calendar dates. Doctor details are refreshed before a preselected-doctor booking.
- Booking requires a valid clinic, complete selected member and successfully loaded, open, non-full availability. Slot errors are visible and retryable.
- Late availability responses cannot overwrite a newer doctor/date selection. Options retry clears stale loading/error state and restores consistent doctor/clinic objects.
- Returning without confirmed payment routes back to the portal's appointments destination when available, never blindly pops the root route. No guessed payment success/token is produced.
- Patient notifications, family, search, appointments and payment loaders no longer convert primary API/auth failures into successful empty lists. Primary staff directories/queues/appointments also expose those errors and load complete pages.
- Refunded/failed/pending receipts do not count as paid appointment money. Cancelled/refunded appointments do not display a new outstanding payment demand.
- Patient queue resolves today's eligible issued token, not the first old/future appointment in an arbitrary first page, and auto-resolution refreshes rather than pinning a stale visit forever.
- Reception Check-in was a placeholder despite an existing backend endpoint. It now uses the website's today/active/payment-complete/issued-token eligibility, search and POST /appointments/:id/check-in flow.
- Reception collections include partial balances, exclude cancelled/refunded/zero-due and pending-online-checkout bookings, and preserve masked doctor-fee visibility.
- OPD editing accepts existing 5-minute/custom valid durations without dropdown assertions. Refresh refetches clinics/hours/closures instead of only changing the displayed timestamp.
- Future-returning setState callbacks were corrected in OPD, complaints and multiple retry controls. A source-integrity regression test guards this pattern.
- Reception and doctor appointments share date/status/action handling. Date-range CSV exports fetch all pages, preserve original booking timestamps and generate real filtered attachments. Staff-only extra slip action was removed to retain website parity.
- Legacy free-text blood groups remain editable without an unmatched dropdown assertion.

## Verification

- 202 Flutter tests passed; Flutter analyzer reports no issues; debug APK built successfully.
- Populated fixtures exercise booking submission, closed/full/error slot blocking, availability races, retry recovery, returning from pending checkout, refunded amounts and today queue selection.
- Staff fixtures exercise payment-gated check-in, partial clinic collections, OPD save/refresh for 5/7 minute schedules and actual date-filtered CSV attachment content at 320px/large text scale.
- Read-only production public doctor API responds successfully and matches the native response contract. Unauthenticated access to platform charges returns 401 as expected; this is not evidence that an authenticated request fails.
- No live booking, payment, clinic check-in, refund, Google account mutation or AWS change was performed in this audit. Mutating workflow tests use isolated HTTP fixtures and mock OS-share/plugin channels.

## Remaining live acceptance checks

- Google account picker and Android OAuth certificate registration require a real-device login test; no successful Google login was claimed from mocked tests.
- Real Razorpay/UPI capture and background-resume callbacks require an authorized user transaction; none was initiated automatically.
- Physical Android share targets, keyboard/insets and populated real-account role flows remain acceptance checks, not proven by fixture/layout tests.
- At final build verification the connected phone was ADB unauthorized. Installation requires the user to allow USB debugging again.

The existing user XML, unrelated web/backend edits and production account data were preserved.
