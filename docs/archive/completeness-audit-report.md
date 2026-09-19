# BookMyDoctor24 — Full Completeness Audit

**Date:** 6 Sep 2026
**Method:** 4 parallel read-only investigations — backend, web frontend, mobile, and cross-stack parity — followed by this synthesis. Nothing has been changed yet; this is findings only, ranked so you can decide what to prioritize.

An earlier report (`project-check-report.md`, 22 Aug 2026) flagged two review-related bugs from when this app was still frontend-only. **Both are confirmed fixed** on web now that the real backend exists (see "Already fixed" below).

---

## The big picture

Across ~4 stacks (backend, web, mobile) this is a genuinely large, mostly-real product — not a scaffold. The gaps below fall into three very different buckets, and they need different responses:

1. **One entire feature was never built**: e-prescriptions. Spec'd in full in `integration_plan.md`, zero implementation anywhere (no route, no service, no schema table). This is the single biggest gap.
2. **A handful of screens fake success or silently do nothing** — these are worse than "missing," because a user believes something happened when it didn't. Highest priority to fix regardless of what else you choose to do.
3. **Mobile is behind web in specific, identifiable places** (and web is behind mobile in exactly one place) — normal for a two-client product, but a few of these gaps are policy-relevant (Play Store account deletion) or block a core daily workflow.

---

## Priority 1 — Fix regardless of anything else (fakes success / silently no-ops)

| # | What | Where | Why it's urgent |
|---|---|---|---|
| 1 | **Web: Superadmin's "Booking rules" page (`/admin/booking-rules`) shows a green "saved" message but never reaches the server.** It uses a generic `AdminForm` wired to a local-only `saveDraft()` — not the real `PUT /admin/booking-rules`. A *different, correct* version of this exact form already exists at `/admin/settings` (`PlatformSettings`). | `client/src/App.jsx:261`, `client/src/pages/FeaturePages.jsx:607` | A superadmin can believe they changed the cancellation policy platform-wide and be wrong — nothing actually changed. False positive on a policy screen. |
| 2 | **Web: Receptionist "Walk-in registration" — the role's #1 sidebar item and dashboard's main button — has never worked.** The form collects everything and shows a message on submit saying the feature isn't available (no backend endpoint to create a patient inline). | `client/src/pages/StaffPages.jsx:663` | Every receptionist hits this on literally every walk-in patient, every day. |
| 3 | **Web: doctor/receptionist have no way to cancel an appointment or mark no-show.** The backend supports it (`PATCH /appointments/:id/status` accepts `cancelled`/`no_show` for any staff role) and mobile has full support — web's shared appointment table only wires "Confirm" and "Complete" buttons. | `client/src/pages/StaffPages.jsx` (`AppointmentTable`) | Staff cannot cancel a booking or record a no-show from the web app at all — a core desk workflow. |
| 4 | **Web: "Users" (`/admin/users`) and "Roles & permissions" (`/admin/roles`) are stub tables** — Users shows blank City/Status columns and misses any patient with zero appointments (comment claiming "no /patients endpoint" is now false — it exists and a *correct* version already exists at "Patients"); Roles & permissions is just the receptionist list relabeled, with no way to actually change a role. | `client/src/App.jsx:258,263` | Misleading page names; both duplicate real, correct pages elsewhere. |
| 5 | **Web: doctor's "Follow-ups" schedule button does nothing, with zero feedback** — not linked from any sidebar, but reachable by URL. | `client/src/pages/FeaturePages.jsx:452` | Low exposure (orphaned route) but worth deleting rather than leaving a feedback-less fake action live. |

**Suggested fix approach**: #1 is a one-line route fix (point at the real form). #4/#5 are deletions or route re-pointing, not new work. #2 and #3 need small backend additions (a create-or-find-patient-then-book endpoint for walk-ins; nothing new needed for #3 — web just needs to call the endpoint that already exists and already works for mobile).

---

## Priority 2 — One feature was never built at all

**E-prescriptions.** `integration_plan.md` §1.10 documents a complete `/prescriptions` module (doctor writes a prescription with per-medicine name/dosage/frequency/duration/instructions, patient/doctor/admin can read it) with the same level of exact detail as every other module that *does* exist. There is no `prescriptions` route, service, or Prisma model anywhere in the backend — confirmed via a full-codebase search. `medicalRecords` (a sibling feature — clinical notes/care plans) was built; prescriptions was not.

This is worth a direct decision from you: was this dropped on purpose, or lost somewhere? If it's needed, it's a real, scoped feature build — new Prisma model, new backend module (mirroring `medicalRecords`'s shape), then a doctor-side "write prescription" screen and patient-side "view prescription" screen on both web and mobile.

---

## Priority 3 — Mobile behind web (specific, real gaps)

| # | Feature | Impact |
|---|---|---|
| 1 | **Delete city/area/specialization** — backend supports it, web has it, mobile's own code comment incorrectly says "not supported" (it's been in the API all along). | High — mobile admin can't fix a mis-entered location without switching to web. |
| 2 | **Forgot/reset password** — no screen, no link, on mobile at all, for any role. | High — a mobile-only user who forgets their password is locked out with no self-service recovery. |
| 3 | **Online self-pay (Razorpay)** — web patients can pay online; mobile's payments screen is view-only. | High — mobile patients must wait for a receptionist or switch to web to pay. |
| 4 | **Doctor "My reviews"** — the screen exists on web (and the backend endpoint works fine), nothing equivalent on mobile. A mobile doctor has zero visibility into patient feedback. | Medium-high |
| 5 | **Admin "Patients" directory** — real backend endpoint, real web page, no mobile screen. | Medium |
| 6 | **Multi-doctor clinic staffing** (assign/remove a doctor from a shared clinic, per-doctor online-booking toggle) — full UI on web, nothing on mobile. | Medium |
| 7 | **No in-app account-deletion or contact-form submission on mobile** — the web `/delete-account` page (built for Play Store policy) is contact-form-based; mobile has no way to submit a contact request at all, from any role. | Medium, **policy-relevant** — Play Store generally expects an in-app path, not "please switch to a browser." |
| 8 | **File uploads (profile photo, doctor verification docs, clinic payment QR)** — all real backend endpoints, all used on web, none reachable from mobile (no image-picker dependency exists in the mobile project at all). | Medium |
| 9 | Revenue-trend chart (`GET /admin/revenue-trend`) — real backend endpoint, unused by **both** web and mobile (web derives its charts from raw payment lists instead). | Low — flagging since it's a working capability nobody's using anywhere. |
| 10 | Doctor self-registration — deliberately patient-only on mobile's register screen (may well be intentional — worth a quick confirm rather than treating as a bug). | Low, needs a decision not necessarily a fix. |

## Priority 3b — Web behind mobile (the one place this runs the other way)

**Broadcast "single user" targeting** — the backend and mobile both support sending a notification to one specific user (`audience: single_user` + a target id); web's broadcast composer only offers All/Patients/Doctors/Receptionists. Small, well-scoped fix (add one dropdown option + an id field, mirroring what mobile already has).

---

## Priority 4 — Backend health items (not user-facing, but matter before/at launch)

- **No notification actually fires from a real event.** The inbox/broadcast system works, but nothing in `appointments`, `payments`, `doctors` (verification), `clinics` (approval), `reviews`, or `complaints`/`contact` ever calls it when something happens — only a manual admin broadcast and one password-reset notice exist today. A patient whose appointment gets cancelled, or whose complaint gets a response, only finds out by re-opening that list themselves.
- **No email/SMS/push provider anywhere** — already known (password-reset link is log-only); this is the same root cause as the point above. Needs your decision on a provider (SES/SendGrid/Twilio) before either can be fully closed.
- **No way to disable a doctor's or patient's login** (only their profile/verification status) — an admin dealing with a fraudulent or abusive account has no lockout mechanism today.
- **Migration drift**: `schema.prisma` already declares a composite index that the actual migration file on disk doesn't have yet — needs `npx prisma migrate dev` run against your real database to reconcile (you already know you need to do this from the last optimization pass; flagging that it's still outstanding).
- Minor: `familyMembers` list isn't cached like every sibling module; Swagger API docs only cover the `auth` module; a couple of small dead-code items (`updatePhoto` no-op, stale code comments claiming gaps that have since been closed).

---

## Already fixed (from the old 22 Aug report — no action needed)
- `/doctor/reviews` now correctly shows the doctor their own received reviews (used to show a patient-facing "write a review" form).
- `/admin/reviews` now correctly moderates real reviews (used to duplicate the Complaints table).
- Mobile independently already has admin review moderation working — only the *doctor-side* "my reviews" screen is missing there (see Priority 3, #4).

---

## What I'd suggest as a next step

Given the range here — some of this is a 10-minute fix (re-point a route), some is a multi-day feature build (prescriptions) — I'd rather you tell me where to start than guess. Natural groupings:

- **A. Quick wins only** (Priority 1's #1/#4/#5, and the single-user broadcast fix) — an hour or two of work, all web-side, zero new backend needed.
- **B. Close the two "core workflow broken" gaps** — walk-in registration and staff cancel/no-show (#2/#3 above) — needs a small new backend endpoint for walk-ins, plus wiring the existing status endpoint into the web appointment table.
- **C. Bring mobile up to parity** on the highest-impact items (forgot-password, geography delete, online payment, doctor reviews) — one at a time or as a batch.
- **D. Scope and build Prescriptions** — the one fully-missing feature, needs your call on whether it's wanted first.
- **E. Wire up real notifications** for the actual app events (appointment/complaint/review status changes) — moderate backend work, no new UI needed since the inbox already exists.

Tell me which of these (or which specific items) to start on, and I'll get going.
