/**
 * Shared helper: fetches the singleton platform_charges row's commissionPercent — only ever
 * needed for an admin/superadmin view (every other role has commission masked out of its
 * response) — so callers only pay for this extra query when the requester is actually
 * admin/superadmin.
 *
 * Extracted from appointments.service.js and payments.service.js, which each independently
 * defined a byte-identical `loadCommissionPercentIfAdmin` (payments.service.js's own comment
 * explicitly noted it was "duplicated locally rather than cross-imported from
 * appointments.service.js" — found during the duplication audit, 2026-09-05). Lives in
 * src/services/ (not inside either module) so this stays a shared *service*-layer helper rather
 * than one module importing from another, preserving the modules'-don't-import-each-other
 * convention.
 */
const prisma = require('../config/db');
const { ADMIN_ROLES } = require('../utils/roles');

/**
 * @param {string} role
 * @returns {Promise<import('@prisma/client').Prisma.Decimal|null>}
 */
async function loadCommissionPercentIfAdmin(role) {
  if (!ADMIN_ROLES.includes(role)) return null;
  const pc = await prisma.platformCharges.findUnique({ where: { id: 1 }, select: { commissionPercent: true } });
  return pc ? pc.commissionPercent : null;
}

/**
 * Unconditional fetch — no role gate. For internal fee-calculation call sites (e.g.
 * utils/minBookingAmount.js's computeMinBookingAmount) where commissionPercent itself is never
 * returned to the caller, only baked into a derived rupee figure that IS safe to expose (rule 8
 * only blocks the raw percent, not every number it feeds into). Contrast with
 * loadCommissionPercentIfAdmin above, which gates on role because ITS caller returns the raw
 * percent verbatim to admin views.
 * @returns {Promise<import('@prisma/client').Prisma.Decimal|null>}
 */
async function loadCommissionPercent() {
  const pc = await prisma.platformCharges.findUnique({ where: { id: 1 }, select: { commissionPercent: true } });
  return pc ? pc.commissionPercent : null;
}

module.exports = { loadCommissionPercentIfAdmin, loadCommissionPercent };
