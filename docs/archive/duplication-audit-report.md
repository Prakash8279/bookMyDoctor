# BookMyDoctor24 — Duplication & Repetition Audit

**Date:** 5 Sep 2026 (updated same day — continuation pass)
**Method:** 4 parallel read-only investigation passes (backend, web frontend, mobile, cross-stack), followed by two fix passes applying the lowest-risk, purely-mechanical findings directly and leaving every finding that touches business/authorization logic, or spans many files with subtle per-copy differences (or that needs visual verification this environment can't do), as a flagged recommendation for a deliberate follow-up.

This report lists **everything found**, then a clear line under **"Applied in this pass"** vs **"Found, deliberately not touched yet"** — so nothing here is a surprise change, and nothing found is silently lost either.

---

## Applied in this pass

### Backend (`server/server/src`)

| Fix | Files touched |
|---|---|
| `ADMIN_ROLES`/`STAFF_ROLES` — was independently declared `['admin','superadmin']` / `['doctor','receptionist']` in 9 service files — now one shared `src/utils/roles.js` | `appointments.service.js`, `payments.service.js`, `complaints.service.js`, `medicalRecords.service.js`, `receptionists.service.js`, `platformCharges.service.js`, `reviews.service.js`, `doctors.service.js`, `clinics.service.js` |
| `formatDateOnly`/`todayUTCDateOnly` — byte-identical date helpers in 3 files — now `src/utils/dateOnly.js` | `appointments.service.js`, `queue.service.js`, `admin.service.js` |
| `loadCommissionPercentIfAdmin` — byte-identical function, and `payments.service.js`'s own comment admitted it was "duplicated locally rather than cross-imported" — now `src/services/commissionLookupService.js` | `appointments.service.js`, `payments.service.js` |
| `me.service.js` had its **own, weaker** local reimplementation of the already-shared `pickPresentFields` (missing the `nonNullableFields` defense-in-depth guard every other module gets) — now imports the shared one | `me.service.js` |

All four are pure, behavior-preserving extractions — same logic, one source of truth. Verified with `node --check` on every touched file.

### Frontend (`client/src`)

| Fix | Files touched |
|---|---|
| **Real bug fixed:** the "Cancellation window (hours)" field's empty-state fallback was hard-coded to `24` — the backend's actual default (schema + runtime fallback) is `2`. If an admin ever saved this form before the real value loaded, it would have silently overwritten the cancellation policy from 2 hours to 24. Now matches the backend. | `AdminPages.jsx` |
| `formatDate`/`formatMoney`/`shortId` — 8 independent copies (one, in `AdminPages.jsx`, was even a *weaker* variant missing the invalid-date fallback the other three had) — now one `src/lib/format.js` | `AdminPages.jsx`, `PatientPages.jsx`, `FeaturePages.jsx`, `PortalSectionPages.jsx`, `PlatformCharges.jsx`, `StaffPages.jsx` |
| `COMPLAINT_STATUS_LABELS`/`CONTACT_STATUS_LABELS` — colocated into one `src/lib/statusLabels.js` with comments cross-referencing the backend enum + validation files + the mobile screens that also hand-maintain these same values, so a future status change is easy to notice everywhere it needs to happen | `AdminPages.jsx`, `PortalSectionPages.jsx` |

Verified with `esbuild` (JSX syntax) on every touched file.

### Frontend — continuation pass (delete-with-confirm hook + CSV helper)

| Fix | Files touched |
|---|---|
| **Real bug fixed:** `PatientPages.jsx`'s `Family.remove` had no busy-state at all (unlike the other 3 delete-with-confirm flows) — a double-click on "Remove" could fire `removeFamilyMember` twice before the first request resolved. Extracted a shared `useDeleteWithConfirm` hook (`src/hooks/useDeleteWithConfirm.js`) used by all 4 delete flows; `Family` now gets the same busy-state (button disables, shows "Removing…") the others already had. | `PatientPages.jsx` (bug fix), `PortalSectionPages.jsx`, `AdminPages.jsx` (mechanical dedup, no behavior change) |
| CSV cell-escaping + Blob/anchor-download boilerplate — independently reimplemented in `AdminPages.jsx` (`csvCell`/`downloadCsv`), `FeaturePages.jsx`, `StaffPages.jsx` (x2), and 3 separate `exportCsv` functions in `PatientPages.jsx` — now one `src/lib/csv.js` (`csvCell`, `buildCsv`, `downloadCsv`) | `AdminPages.jsx`, `FeaturePages.jsx`, `StaffPages.jsx`, `PatientPages.jsx` |

Verified with `esbuild` on every touched file. Note: the CSV helper standardizes on `String(value ?? '')` (empty string for a missing value) everywhere — two of the merged copies (`FeaturePages.jsx`'s `clinicRecordsCsv`, `StaffPages.jsx`'s `opdEntryCsv`) previously used `String(value)` with no `??` guard, which would have printed the literal text `"undefined"` for a missing field instead of a blank cell. Minor, low-risk behavior improvement, not a regression.

### Mobile / Cross-stack

No mobile files were changed in this pass (see "Deferred" below) — the one cross-stack **actual drift bug** found (the cancellation-window default) is a web-frontend-vs-backend mismatch and is already listed above.

---

## Found, deliberately not touched yet

These are real, confirmed duplication — just not the kind that's safe to mechanically extract in one pass. Each is either (a) business/authorization logic where a shared implementation risks becoming a single point of failure across resource types, or (b) large enough (many files, or per-copy behavioral differences already spotted) that it deserves its own reviewed, tested pass rather than being bundled in here.

### Backend — needs a deliberate pass
- **Pagination (`page`/`pageSize`) and `param('id').isUUID()` validator fragments** — copy-pasted across ~20 `*.validation.js` files each. Purely mechanical, but touches every validation file in the codebase — recommend as its own small PR.
- **`rejectNull()` helper** — duplicated in 6 validation files (already self-documented in code comments as "mirrors the identical helper in...").
- **Clinic-owner check / receptionist-clinicId lookup** — duplicated 3x and 10x respectively across `clinics`, `receptionists`, `uploads`, `appointments`, `queue`, `payments` services.
- **`shapeFees`/`shapePaymentFees` + `shapePatientRef`/`shapeQueuePatientRef`** — the role-based money/clinical-data masking functions in `appointments.service.js` and `payments.service.js`/`queue.service.js` are structurally identical. **Higher risk to merge** — this is exactly the "receptionist must never see clinical fields" rule, so a shared implementation needs careful review, not a mechanical extract.
- **`getVisibleXOrThrow` authorization skeleton** — same shape in 6 modules. Recommend factoring only the safe sub-pieces (404-not-403 fallback, the receptionist-clinic lookup) rather than a single shared authorization function.
- **Singleton-config get/upsert pattern** (`admin.service.js` x2, `platformCharges.service.js`) and the **account-provisioning template** (`auth.service.js`, `doctors.service.js`, `receptionists.service.js`) — mechanical skeletons, but each has enough field-specific variation that a generic factory could over-abstract; low urgency at only 2-3 instances each.

### Frontend — needs a deliberate pass
- **Local `Page`/`Button`/`ErrorNote` components** redefined in 7-8 page files. Looked at merging these in the continuation pass and deliberately held off: `Button` alone has at least 3 visually different variants (a single-style version, a CSS-class `btn-primary` version used in `PublicPages.jsx`/`FeaturePages.jsx`, and 2 different `tone`-aware versions in `StaffPages.jsx`/`AdminPages.jsx` with different tone options), and `Page` in `PlatformCharges.jsx` uses a genuinely simpler markup structure (no header flex-row, no `action`/`kicker` support) rather than just omitting props. This sandbox has no way to render the app and visually diff before/after, so merging these blind risks a silent layout/style regression across admin, staff, and patient screens — exactly the kind of change that needs a human looking at the actual rendered pages, not a mechanical text edit.
- **Fetch-on-mount + loading/error boilerplate** — the single largest duplication found (~25-30 near-identical blocks, 150-250+ lines) but explicitly flagged as risky to unify blindly: call signatures vary (single fetch vs. `Promise.all` vs. chained `.then`), and a couple of components deliberately skip the loading state on first mount by role. Needs a dedicated pass with per-component verification.

### Mobile — needs a deliberate pass (nothing changed yet)
- **Doctor/receptionist appointments screens** and **doctor/receptionist queue screens** — each pair is ~95% duplicated, including the appointment/queue status-transition state machines. This is the highest-value mobile finding but also the riskiest (duplicated business logic, not just UI).
- **Admin/doctor receptionist-management screens** and **admin complaints/contact screens** — whole files duplicated, but assessed as small/safe (only query params and field names differ) — good candidates for a first mobile dedup pass.
- **Dashboard `_StatTile` widget** (3x), **status-filter chip row** (4x), **bottom-sheet form wrapper** (~9x), **form-submit try/catch boilerplate** (~13x), **weekday-name and blood-group constants** (2x each) — all small/safe, mechanical extractions.
- **Patient/receptionist booking's async POST-then-poll flow** — flagged as the riskiest mobile duplication (timing-sensitive, three-way status branching).

### Cross-stack — documented, not code-changed (by design)
- **Complaint/contact status enums** and **payment mode enum** — 3 independently hand-maintained copies each (backend enum + validation, web label map, mobile screen) — values agree today; not worth shared infra across a JS/JS/Dart boundary, so left as documented duplication (the new `statusLabels.js` comment cross-references the others).
- **Admin pricing-settings "live example bill" preview** (`PlatformCharges.jsx`) re-derives the backend's fee formula for a preview widget — formula agrees today; genuinely a business-math duplication (the only one found — everywhere else, frontend/mobile only display backend-computed numbers) but low-risk enough to leave as documented duplication rather than restructure a preview widget.
- **Notification audience gap** — the web broadcast composer doesn't expose `single_user` targeting that both the backend enum and the mobile composer support. Not a bug (no wrong data), just an incomplete web feature — flagged as a product question, not a code fix.
- **Password minimum length (8 chars)** and **"non-cash payment needs a transactionRef" rule** — duplicated across 2-3 stacks, values agree today, standard/expected duplication for independent codebases sharing an API contract.

---

## False positives (checked, not actually a problem)
- Web `StatusPill` tones and mobile `statusColor()` — independent presentational (color-only) mappings; a missing key only affects styling, not correctness.
- Fee figures shown to patients/doctors/in reports — confirmed to be backend-computed numbers, display-only on every client (explicitly commented in the code as "no client-side commission math needed anymore").
- Role names in frontend route guards / mobile router — UI-routing convenience only; actual authorization is enforced server-side on every request regardless of what the client thinks the role is.

---

## Recommended next steps, in order
1. Mobile: extract the 5 "small/safe" mobile findings (StatTile, status-filter chip bar, bottom-sheet wrapper, form-submit boilerplate, weekday/blood-group constants) — quick wins, zero behavior risk.
2. Mobile: merge the admin/doctor receptionist-management screens and admin complaints/contact screens — small/safe, biggest mobile line-count reduction.
3. Frontend: extract the shared `Page`/`ErrorNote`/`Button` components — needs a visual before/after check (run the app, compare screens) since the 3 `Button` variants and `PlatformCharges.jsx`'s simpler `Page` aren't drop-in identical.
4. Backend: the pagination/id-param validator fragments — mechanical but touches ~20 files, worth its own reviewed PR.
5. As a deliberate, carefully-tested pass (not mechanical): the appointments/queue/payments role-masking functions (`shapeFees`, `shapePatientRef`) and the mobile appointment/queue screens' shared board widget — both touch real business/authorization logic.

~~Frontend: build the CSV helper and the delete-with-confirm hook~~ — done in the continuation pass (see "Applied in this pass" above).
