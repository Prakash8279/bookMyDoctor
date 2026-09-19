// Status display-label maps for the two admin-response ticket flows.
// Colocated here (rather than left as separate hand-authored objects inside AdminPages.jsx and
// PortalSectionPages.jsx) purely so the two status vocabularies sit next to each other — they are
// intentionally SEPARATE domains with different legal values (complaints vs. contact requests),
// not a single merged map, but a future change to one is now easy to notice next to the other.
//
// Keep these in sync with:
//   - server/server/prisma/schema.prisma: `enum ComplaintStatus` / `enum ContactStatus`
//   - server/server/src/modules/complaints/complaints.validation.js (isIn([...]))
//   - server/server/src/modules/contact/contact.validation.js (isIn([...]))
//   - mobile/lib/screens/admin/admin_complaints_screen.dart / admin_contact_screen.dart
// (flagged during the cross-stack duplication audit, 2026-09-05 — each of the above independently
// hand-maintains the same value set; not worth shared infra across a JS/Dart boundary, but worth
// a single reminder comment on every copy so a future enum change doesn't miss one).

export const COMPLAINT_STATUS_LABELS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' }

export const CONTACT_STATUS_LABELS = { open: 'Open', responded: 'Responded', resolved: 'Resolved' }
