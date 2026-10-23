# Android website-content trim — 22 October 2026

Baseline: local website source; existing website/backend data and unrelated changes were not modified.

## Removed or aligned

- Patient dashboard: removed the app-only Find doctors entry and History/Reviews shortcut tiles. Public doctor discovery and the website-existing appointment-history/review workflows remain available through their corresponding screens; no records were deleted.
- Patient/staff dashboard shortcut order now matches PATIENT_SERVICES / STAFF_SERVICES in the website. Patient Profile remains in the grid because it is present in the website grid.
- Reception bottom navigation now matches the website: Home, Appointments, Walk-in, Queue, Profile; removed the extra Payments bottom tab (Payments remains a dashboard service).
- Mobile patient/doctor/reception headings now show the website's compact welcome text, not the extra desktop kicker, explanatory subtitle and action button.
- Removed old admin Today visits / Monthly revenue and superadmin Monthly revenue cards; kept website-selected-period summaries.
- Removed extra portal-header theme action, device-theme dropdown and profile Contact/Legal/Delete shortcut block. Profile keeps Save, Change password and Sign out. Website Help & Policies services retain contact, legal and account deletion access for patient/staff.
- Public Privacy/Terms now use the same shared policy content as Help & Policies, removing obsolete draft/placeholder copies.
- Existing API access control, payment verification, queue gating, PDF/CSV generation and account data were not weakened or removed.

## Evidence

- 182 Flutter tests pass; analyzer reports no issues.
- New contract tests read website source and compare the three compact-role service grids and bottom destinations against native rendered navigation.
- New public-policy test checks shared content and absence of obsolete draft placeholders.
- Light/dark role screenshots regenerated; patient/doctor dashboards visually inspected.

This is a focused removal of identified excess native UI, not proof of pixel-perfect parity on every populated page. Android installation is performed separately after the final build.
