# BookMyDoctor24 — Project Check Report

**Date:** 22 Aug 2026
**Scope:** `client/` (React + Vite + Tailwind + Zustand + Chart.js, frontend-only, localStorage-backed healthcare platform)

## Summary

The codebase is in good shape overall: consistent structure, no dead files, no leftover TODOs/debug statements, and every route in `App.jsx` maps to a real, non-trivial component. Static checks (import resolution, JSX syntax, undefined variables, unused variables, duplicate keys) all came back clean. Two functional bugs were found in the reviews feature, both concrete and fixable.

## 1. Build & lint

`npm install` could not complete in this sandbox — the environment's network policy blocks `registry.npmjs.org` outright (`403 host_not_allowed` on every package), so `vite build` and `npm run lint` (oxlint) could not be executed here. This is a sandbox restriction, not a project issue — the scripts themselves (`npm run dev`, `npm run build`, `npm run lint`) are configured correctly in `package.json`.

As a substitute, static checks were run directly against the source:

- **Syntax/parse check** (esbuild) on all 29 `.js`/`.jsx` files — 0 errors.
- **Bundle/import-resolution check** (esbuild, bundling `main.jsx` with all npm packages marked external) — resolved cleanly, 0 missing modules, 0 broken relative imports.
- **Static lint** (ESLint core rules: `no-undef`, `no-unused-vars`, `no-dupe-keys`, `no-unreachable`, `no-redeclare`, `no-cond-assign`, etc.) across `src/` — 0 errors, 0 warnings.
- Grep sweep for `TODO`/`FIXME`/`console.log`/`debugger` — none found.

Recommend running `npm install && npm run build && npm run lint` yourself once (locally, where the real npm registry is reachable) as a final confirmation before shipping — this report's static checks are a strong proxy but not a full substitute for Vite's actual build and oxlint's React-aware rules.

## 2. Bugs found

### Doctor's "Patient reviews" page shows the wrong screen
`/doctor/reviews` is routed to the same `PatientReviews` component as `/patient/reviews` (`App.jsx` line 76, component in `pages/FeaturePages.jsx`). That component is a **patient-facing "write a review about a doctor"** form — it lists the first two doctors in the system with a "Write a review" button. A logged-in doctor visiting their own "Patient reviews" page therefore sees a form to review other doctors, not the feedback their own patients have left for them. There's currently no page that shows a doctor their received reviews.

### Admin's "Review moderation" duplicates "Complaints"
`/admin/reviews` (`ReviewModeration` in `pages/PortalSectionPages.jsx`) and `/admin/complaints` (`Complaints` in `pages/AdminPages.jsx`) both render `data.complaints` in near-identical tables. Meanwhile, actual patient reviews (`data.reviews`, populated correctly — with rating and doctorId — by the review form on the patient's "My appointments" page) are never shown to admins anywhere. The two menu items are effectively the same screen twice, and there's no moderation view for reviews at all.

Both issues trace back to the same root cause: the review-moderation and doctor-facing review screens were never wired to `data.reviews`. The patient-side review *submission* itself works correctly — the well-built version lives in `PatientAppointments` ("My appointments" → "Review a completed consultation"), which properly ties a review to a specific completed appointment, a real 1–5 rating, and the doctor's id. The simpler, appointment-less form in `PatientReviews` (used for `/patient/reviews`) is redundant with that and always hardcodes a 5-star rating with no appointment/doctor-id link — worth removing or fixing rather than leaving both in place.

## 3. Feature completeness

Every feature named in the README is implemented and routed for all five roles (patient, doctor, receptionist, admin, super admin), confirmed against `App.jsx`'s ~90 routes and the ~65 exported page components:

- **Auth:** Login, Register (patient/doctor toggle), Forgot password, role-based redirect, `ProtectedRoute` guarding all portal routes, super admin can inspect every role's workspace.
- **Appointments:** booking with live fee/GST preview, appointment list, booking history, CSV export, downloadable booking slip, emergency booking.
- **Payments:** patient payment history, receptionist cash collection, doctor payment setup (cash/UPI toggles), platform charges (commission/patient fee/emergency fee/GST) configurable by admin/super admin, doctor-only visibility on their own consultation share (`paymentVisibility.js`).
- **Queues:** live queue widget, queue tracker (patient), queue management with call-next/skip/pause (doctor/receptionist), walk-in registration, check-in.
- **Profiles & records:** patient profile/settings, family members, prescriptions, EMR, doctor profile edit, patient history.
- **Admin:** doctor/clinic verification, manage patients/doctors/receptionists/clinics, cities & areas, specializations, complaints, contact inbox, broadcast, audit/activity log, platform settings, revenue reports with Chart.js analytics.

This is a genuinely complete demo, not a scaffold with stub pages — every menu item in every role's sidebar resolves to a working, data-driven screen, aside from the two reviews issues above.

## 4. Minor observations (not bugs, worth knowing)

- Passwords are stored in plaintext in `localStorage` (demo accounts included, e.g. `admin@connectdoctor.test`). Expected and fine for a frontend-only demo with no backend, but worth remembering if this ever needs to go further than a demo.
- Registration's password length is only enforced via the HTML `minLength="8"` attribute, not re-checked in the store's `register()` action the way `changePassword()` re-checks it. Low risk (client-only app), but inconsistent.
- "Continue with Google" buttons are honestly stubbed with an explanatory message rather than faking a working OAuth flow — good call for a browser-only demo, not an issue.
