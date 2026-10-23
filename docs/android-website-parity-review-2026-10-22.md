# Android / website parity review - 22 October 2026

Status: implementation and local verification; not a claim of complete feature or pixel parity.

## Implemented in this pass

- Shared role bottom navigation, notification header action and profile shortcut.
- Follow-up: mobile widths no longer mount the duplicate sidebar/hamburger. Admin/superadmin dashboard shortcut grids preserve access to all sections, and Profile now includes confirmed sign-out. Wide desktop layouts retain the drawer.
- Mobile quick-action grids; removed doctor EMR navigation and redundant reception shortcuts.
- Repeated overflow fixes across public, patient, doctor, reception, admin and superadmin destinations.
- Doctor dashboard today-only India-date workload/revenue, with midnight date rollover.
- Doctor appointments default to today's India visit date, with historical date selection.
- Website doctor/reception appointment filters default and reset to today; today rolls forward while an explicitly selected historical date is preserved.
- Payment verification polls the existing appointment and reuses the same signed payment response; a timeout is pending, not confirmed/failed, and cancellation never counts as success.
- Doctor/reception appointment action buttons respect the server clinic-payment gate.
- Approximate visit-time formatting in appointment-related screens.
- Real UTF-8 CSV attachments, spreadsheet formula protection and complete-page loading safeguards.
- Paid-positive-only doctor/admin revenue aggregates; unsuccessful receipts remain in history.
- Local branded PDF booking/receipt export with licensed bundled fonts, Hindi text, original booking/payment timestamps and multi-page notes.
- Public patient stories use approved API reviews only, with automatic transitions and reduced-motion support; removed invented sample testimonial.
- Inter font bundled for offline UI typography.
- Native persisted light/dark appearance with the website-style profile toggle (public header retains its theme action). Removed the app-only device-theme dropdown and portal-header theme action. Semantic surfaces, borders, text and status colours follow the selected theme.
- Removed duplicate patient-home metric cards and service tiles; retained shared navigation shortcuts and appointment/alert content.
- Admin/superadmin selected-period booking/revenue summary and export, defaulting to today's India date.
- Today/range/All-date filtering, pagination and selected-record CSV export for doctor/patient/receptionist directories, clinics, reviews, complaints, contact requests, activity logs, refunds and reconciliation. Appointments have today-default filters, pagination and filtered CSV export.
- Admin API failures no longer silently become empty lists. Complete-page loading preserves KPI metadata and rejects incomplete or duplicate page results.

## Verification

- Flutter regression suite: 220 tests passed after the native booking two-step alignment, including populated patient/staff workflows, real CSV/PDF attachment boundary checks, theme persistence, India-date ranges, pagination and restoring historical records through All dates. See android-functional-audit-2026-10-22.md and android-booking-website-flow-2026-10-22.md for reproduced bugs and live-test limits.
- Layout matrix: light and dark themes, five roles, widths 320/360/390/600/840, text scales 1.0/1.4; traverses every portal destination at the smallest/largest-text combination. Most destination fixtures are empty; this does not prove every populated form is overflow-free.
- Populated public page scrolling, approved-only testimonials, narrow booking-slip layout and date defaults tested.
- Web StaffPages suite: 85 tests passed; frontend build passed.
- Two synthetic PDF samples rendered and visually inspected; rupee amounts and timestamps also verified by PDF text extraction.
- Regenerated role-dashboard screenshots with bundled fonts; visually checked dark patient/superadmin cards and readable actions after correcting white-surface regressions.
- Local Android debug APK built. No live payment, patient booking, account mutation or app publication was performed.

## Outstanding before claiming complete parity/release readiness

- A142 Android phone subsequently connected over USB; debug APK installation and app launch succeeded. Physical-device payment callback/background-resume, download/share targets, keyboard/insets and final visual review remain unverified.
- Full feature/pixel parity still needs a real-device, populated-data acceptance pass; the current app-level text-scale clamp also remains in place.
- Date/export controls above cover transactional records and the named directories, not every settings/reference endpoint or broadcast-history view. Undated records require All dates and are not assigned invented creation timestamps.
- Real-data populated form/action coverage is not exhaustive; empty fixture navigation tests are not a production end-to-end test.
- Android plugin Gradle build emits future Kotlin-plugin compatibility warnings; current debug compilation succeeds.
- No AWS deployment, release upload, Play Store submission or signing credential changes in this pass.

Existing unrelated website/backend changes and the user's untracked mobile XML were preserved. Many otherwise unchanged Dart files were mechanically reformatted by the SDK formatter.

## Additional workflow follow-up

See `android-unfinished-workflows-review-2026-10-22.md` for receptionist registration/confirmation refresh, complete-page data loading, paid-only report totals, actual walk-in counts, clinic/review failure recovery and narrow-screen regression coverage. The expanded full suite passes 220 tests. Phone installation remains pending because no USB device was detected.

