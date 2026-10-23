# Native booking aligned to website — 22 October 2026

Compared against `client/src/pages/PatientPages.jsx` Booking doctor-selection and confirmation views. Website and backend code/data were not changed.

## Implemented

- First step now contains matching doctor cards, not an always-visible appointment form and doctor dropdown.
- Compact expandable Filters heading with the website copy; doctor/clinic-name search, city, specialization, emergency, default/clinic/name/rating/fee sorting, Clear and Apply. Apply closes the filter panel.
- Compact cards show doctor details, first clinic/location, consultation fee, today's real slot/availability counts and emergency flag. Profile and Book remain side by side and navigate independently.
- Book opens a dedicated Confirm appointment step with selected-doctor summary, Change doctor/Back to all doctors, appointment details, complete-member selection, date bounds, compact slot row, reason, price preview and Confirm booking.
- Add member now expands inline, validates all five required fields, saves through the existing API and selects the new complete member. Cancel closes the inline form without writing data.
- The date is reset to the India calendar date when changing doctor; stale availability protection, required-member checks, closed/full-slot gating, pending-payment verification and original booking timestamps remain intact.
- Step changes reset scroll position. Direct standalone routes use a brand toolbar instead of duplicating the page title; embedded portal routes reuse the portal header.
- Price preview now uses semantic dark/light colours and wraps the platform-only consultation label on narrow displays.

## Verification

- 210 Flutter tests pass; analyzer reports no issues; debug APK built successfully.
- New tests verify two-step flow, collapsed filters/search, Profile navigation, side-by-side Profile/Book, Change doctor, inline required-member save-to-book and 320/390/700px light/dark layouts at 1.4 text scale.
- Synthetic light/dark doctor-list and confirmation screenshots rendered and visually inspected.
- No live booking, family-member write or payment was made: all mutations in these tests use isolated API fixtures.
- Physical phone was disconnected at the installation check. This build is ready locally, not yet installed on the phone or published to Play Store.

This aligns the native booking structure and exercised interactions; it is not a claim of pixel-perfect parity or a successful real-payment end-to-end acceptance test.
